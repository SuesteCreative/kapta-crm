'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sparkles, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import type { Template, Interaction } from '@/lib/database.types'

interface Props {
  open: boolean
  customerId: string
  customerEmail: string
  customerName: string
  customerCompany?: string | null
  interactions?: Interaction[]
  onClose: () => void
}

function applyTemplate(body: string, name: string, company: string | null | undefined): string {
  return body
    .replace(/\{\{name\}\}/gi, name)
    .replace(/\{\{company\}\}/gi, company ?? name)
}

export function SendEmailDialog({ open, customerId, customerEmail, customerName, customerCompany, interactions = [], onClose }: Props) {
  const [to,        setTo]        = useState(customerEmail)
  const [subject,   setSubject]   = useState('')
  const [body,      setBody]      = useState('')
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading,   setLoading]   = useState(false)
  const [drafting,  setDrafting]  = useState(false)
  const [language,  setLanguage]  = useState<'pt-PT' | 'en'>('pt-PT')

  useEffect(() => { setTo(customerEmail) }, [customerEmail])

  useEffect(() => {
    if (!open) return
    setSubject('')
    setBody('')
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
          customer_name: customerName,
          customer_company: customerCompany ?? null,
          language,
          interactions: interactions.slice(0, 6).map((i) => ({
            type: i.type,
            direction: i.direction,
            subject: i.subject,
            content: i.content,
            occurred_at: i.occurred_at,
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
        body: JSON.stringify({ customer_id: customerId, to, subject, body }),
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
    onClose()
  }

  const hasEmailHistory = interactions.some((i) => i.type === 'email')

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
              {/* Language toggle */}
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
          <div className="space-y-1.5">
            <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>Para</Label>
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="email@exemplo.com"
              style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            />
          </div>

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
            style={{ background: 'var(--primary)', color: '#fff' }}
          >
            {loading ? 'A enviar…' : 'Enviar email'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
