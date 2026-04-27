'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sparkles, Loader2, ChevronDown, ChevronUp, X } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import type { Template, Interaction } from '@/lib/database.types'

export interface EmailContact {
  label: string
  email: string
}

interface Props {
  open: boolean
  customerId: string
  customerEmail: string
  customerName: string
  customerCompany?: string | null
  interactions?: Interaction[]
  /** All known contacts for this customer / company — shown as quick-add chips */
  allEmails?: EmailContact[]
  /** Pre-fill the subject when dialog opens (e.g. "Re: ..." on reply) */
  initialSubject?: string
  onClose: () => void
}

function applyTemplate(body: string, name: string, company: string | null | undefined): string {
  return body
    .replace(/\{\{name\}\}/gi, name)
    .replace(/\{\{company\}\}/gi, company ?? name)
}

/** Parse comma/semicolon-separated email string into trimmed list */
function parseEmails(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((e) => e.trim())
    .filter(Boolean)
}

/** Tag-chip component for a field */
function EmailTagInput({
  label,
  value,
  onChange,
  suggestions = [],
  placeholder = 'email@exemplo.com',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  suggestions?: EmailContact[]
  placeholder?: string
}) {
  const tags = parseEmails(value)
  const remaining = suggestions.filter((s) => !tags.includes(s.email))

  function addTag(email: string) {
    const next = tags.includes(email) ? tags : [...tags, email]
    onChange(next.join(', '))
  }

  function removeTag(email: string) {
    onChange(tags.filter((t) => t !== email).join(', '))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // When user presses comma/enter/tab — normalize
    if ([',', ';', 'Enter', 'Tab'].includes(e.key)) {
      e.preventDefault()
      const raw = (e.currentTarget as HTMLInputElement).value.trim()
      if (raw) addTag(raw)
    }
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>{label}</Label>

      {/* Tag row + input */}
      <div
        className="flex flex-wrap gap-1.5 p-2 rounded-lg min-h-[36px]"
        style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}
      >
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{ background: 'rgba(91,91,214,0.15)', color: 'var(--primary)' }}
          >
            {t}
            <button onClick={() => removeTag(t)} className="hover:opacity-70">
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[140px] bg-transparent text-sm outline-none"
          style={{ color: 'var(--foreground)' }}
          placeholder={tags.length === 0 ? placeholder : ''}
          onKeyDown={handleKeyDown}
          onBlur={(e) => {
            const raw = e.currentTarget.value.trim()
            if (raw) { addTag(raw); e.currentTarget.value = '' }
          }}
          onChange={() => {}}
        />
      </div>

      {/* Contact quick-add chips */}
      {remaining.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {remaining.map((s) => (
            <button
              key={s.email}
              onClick={() => addTag(s.email)}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-opacity hover:opacity-70"
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                color: 'var(--muted-foreground)',
              }}
            >
              + {s.label} &lt;{s.email}&gt;
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function SendEmailDialog({
  open,
  customerId,
  customerEmail,
  customerName,
  customerCompany,
  interactions = [],
  allEmails = [],
  initialSubject,
  onClose,
}: Props) {
  const [to,          setTo]          = useState(customerEmail)
  const [cc,          setCc]          = useState('')
  const [bcc,         setBcc]         = useState('')
  const [showCcBcc,   setShowCcBcc]   = useState(false)
  const [subject,     setSubject]     = useState('')
  const [body,        setBody]        = useState('')
  const [templates,   setTemplates]   = useState<Template[]>([])
  const [loading,     setLoading]     = useState(false)
  const [drafting,    setDrafting]    = useState(false)
  const [language,    setLanguage]    = useState<'pt-PT' | 'en'>('pt-PT')
  const [refineInput, setRefineInput] = useState('')
  const [refining,    setRefining]    = useState(false)

  useEffect(() => { setTo(customerEmail) }, [customerEmail])

  useEffect(() => {
    if (!open) return
    setSubject(initialSubject ?? '')
    setBody('')
    setCc('')
    setBcc('')
    setShowCcBcc(false)
    supabase
      .from('templates')
      .select('*')
      .eq('type', 'email')
      .order('name')
      .then(({ data }) => setTemplates(data ?? []))
  }, [open])

  function applyTemplateById(id: string) {
    const tpl = templates.find((t) => t.id === id)
    if (!tpl) return
    setSubject(tpl.subject ? applyTemplate(tpl.subject, customerName, customerCompany) : '')
    setBody(applyTemplate(tpl.body, customerName, customerCompany))
  }

  async function handleDraftWithAI() {
    if (interactions.length === 0) {
      toast.error('Sem emails anteriores para gerar rascunho.')
      return
    }
    setDrafting(true)
    try {
      const res = await fetch('/api/ai/draft-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          customer_name: customerName,
          customer_company: customerCompany ?? null,
          language,
          interactions: interactions.slice(0, 6).map((i) => ({
            type: i.type,
            direction: i.direction,
            subject: i.subject,
            content: i.content,
            occurred_at: i.occurred_at,
            metadata: i.metadata ?? null,
          })),
        }),
      })
      const text = await res.text()
      let json: { ok: boolean; subject?: string; body?: string; error?: string }
      try { json = JSON.parse(text) } catch { throw new Error('Servidor sem resposta.') }
      if (!json.ok) throw new Error(json.error ?? 'Erro')
      if (json.subject) setSubject(json.subject)
      if (json.body) setBody(json.body)
      toast.success('Rascunho gerado — revê antes de enviar.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao gerar rascunho.')
    } finally {
      setDrafting(false)
    }
  }

  async function handleRefine() {
    if (!body.trim() || !refineInput.trim()) return
    setRefining(true)
    try {
      const res = await fetch('/api/ai/refine-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentDraft: body, instruction: refineInput, language }),
      })
      const text = await res.text()
      let json: { ok: boolean; body?: string; error?: string }
      try { json = JSON.parse(text) } catch { throw new Error('Servidor sem resposta.') }
      if (!json.ok) throw new Error(json.error ?? 'Erro')
      if (json.body) { setBody(json.body); toast.success('Rascunho ajustado!') }
      setRefineInput('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao ajustar rascunho.')
    } finally {
      setRefining(false)
    }
  }

  async function handleSend() {
    if (!to || !subject || !body) {
      toast.error('Preenche destinatário, assunto e corpo.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          to,
          ...(cc  ? { cc }  : {}),
          ...(bcc ? { bcc } : {}),
          subject,
          body,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Erro desconhecido')
      toast.success('Email enviado!')
      handleClose()
    } catch (err) {
      toast.error('Erro ao enviar email.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    setSubject('')
    setBody('')
    setCc('')
    setBcc('')
    setRefineInput('')
    onClose()
  }

  const hasEmailHistory = interactions.some((i) => i.type === 'email')

  // Suggestions for CC: all contacts except the TO address
  const toEmails = parseEmails(to)
  const ccSuggestions = allEmails.filter((e) => !toEmails.includes(e.email))
  const bccSuggestions = allEmails.filter(
    (e) => !toEmails.includes(e.email) && !parseEmails(cc).includes(e.email)
  )

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent
        className="max-w-xl"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--foreground)' }}>
            Enviar email — {customerName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">

          {/* AI Draft button + language toggle */}
          {hasEmailHistory && (
            <div className="flex gap-2">
              <Button
                onClick={handleDraftWithAI}
                disabled={drafting}
                className="flex-1 h-9 gap-2 rounded-lg text-[13px] font-medium"
                style={{ background: 'rgba(91,91,214,0.1)', color: 'var(--primary)', border: '1px solid rgba(91,91,214,0.25)' }}
              >
                {drafting
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> A gerar rascunho…</>
                  : <><Sparkles className="h-3.5 w-3.5" /> Gerar resposta com IA</>}
              </Button>
              <div
                className="flex items-center rounded-lg overflow-hidden shrink-0"
                style={{ border: '1px solid rgba(91,91,214,0.25)' }}
              >
                {(['pt-PT', 'en'] as const).map((lang) => (
                  <button
                    key={lang}
                    onClick={() => setLanguage(lang)}
                    disabled={drafting}
                    className="h-9 px-3 text-[12px] font-semibold transition-colors"
                    style={{
                      background: language === lang ? 'rgba(91,91,214,0.15)' : 'transparent',
                      color: language === lang ? 'var(--primary)' : 'var(--muted-foreground)',
                    }}
                  >
                    {lang === 'pt-PT' ? 'PT' : 'EN'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* To */}
          <EmailTagInput
            label="Para"
            value={to}
            onChange={setTo}
            suggestions={allEmails}
            placeholder="email@exemplo.com"
          />

          {/* CC / BCC toggle */}
          <button
            onClick={() => setShowCcBcc((v) => !v)}
            className="flex items-center gap-1 text-[12px] font-medium transition-opacity hover:opacity-70"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {showCcBcc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showCcBcc ? 'Ocultar CC / BCC' : 'Adicionar CC / BCC'}
          </button>

          {showCcBcc && (
            <>
              <EmailTagInput
                label="CC"
                value={cc}
                onChange={setCc}
                suggestions={ccSuggestions}
                placeholder="cc@exemplo.com"
              />
              <EmailTagInput
                label="BCC"
                value={bcc}
                onChange={setBcc}
                suggestions={bccSuggestions}
                placeholder="bcc@exemplo.com"
              />
            </>
          )}

          {/* Template selector */}
          {templates.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>Template (opcional)</Label>
              <Select onValueChange={applyTemplateById}>
                <SelectTrigger style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)' }}>
                  <SelectValue placeholder="Escolher template…" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Subject */}
          <div className="space-y-1.5">
            <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>Assunto</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Assunto do email"
              disabled={drafting}
              style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            />
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>Mensagem</Label>
            <Textarea
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={drafting ? 'A gerar…' : 'Escreve a mensagem aqui…'}
              disabled={drafting}
              style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)', resize: 'none' }}
            />
          </div>

          {/* Refine with AI — shown once draft exists */}
          {body.trim() && (
            <div className="flex gap-2">
              <input
                className="flex-1 h-9 rounded-lg px-3 text-sm outline-none"
                style={{
                  background: 'var(--muted)',
                  border: '1px solid var(--border)',
                  color: 'var(--foreground)',
                }}
                placeholder="Ajustar: ex. adicionar link Calendly, pedir nome da conta…"
                value={refineInput}
                onChange={(e) => setRefineInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !refining) handleRefine() }}
                disabled={refining}
              />
              <Button
                onClick={handleRefine}
                disabled={refining || !refineInput.trim()}
                className="h-9 shrink-0 gap-1.5 rounded-lg text-[12px] font-medium"
                style={{ background: 'rgba(91,91,214,0.1)', color: 'var(--primary)', border: '1px solid rgba(91,91,214,0.25)' }}
              >
                {refining
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> A ajustar…</>
                  : <><Sparkles className="h-3.5 w-3.5" /> Aplicar</>}
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button
            variant="outline"
            onClick={handleClose}
            style={{ border: '1px solid var(--border)', color: 'var(--foreground)', background: 'transparent' }}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSend}
            disabled={loading || drafting || !to || !subject || !body}
            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            {loading ? 'A enviar…' : 'Enviar email'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
