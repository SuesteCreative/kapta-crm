'use client'

import { useState, useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sparkles, Loader2, ChevronDown, ChevronUp, X, Paperclip, Image as ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { Template, Interaction } from '@/lib/database.types'
import { readTextStream, extractJsonFields } from '@/lib/ai/streaming'
import { uploadAttachment, type UploadedAttachment, MAX_ATTACHMENT_BYTES } from '@/lib/upload-attachment'
import { compressImage } from '@/lib/compress-image'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

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
  /** Pre-fill the body when dialog opens (template + variables already interpolated) */
  initialBody?: string
  /** Fired after a successful send (before onClose). Optional. */
  onSent?: () => void
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
  initialBody,
  onSent,
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
  const [language,    setLanguage]    = useState<'pt-PT' | 'en' | 'es'>('pt-PT')
  const [refineInput, setRefineInput] = useState('')
  const [refining,    setRefining]    = useState(false)
  const [aiInstruction, setAiInstruction] = useState('')
  const [inlineImages, setInlineImages]   = useState<UploadedAttachment[]>([])
  const [attachments, setAttachments]     = useState<UploadedAttachment[]>([])
  const [uploadingFile, setUploadingFile] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)

  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setTo(customerEmail) }, [customerEmail])

  useEffect(() => {
    if (!open) return
    setSubject(initialSubject ?? '')
    setBody(initialBody ?? '')
    setCc('')
    setBcc('')
    setShowCcBcc(false)
    setInlineImages([])
    setAttachments([])
    fetch('/api/templates?type=email')
      .then((r) => r.json())
      .then((j) => setTemplates(j?.ok ? j.templates : []))
      .catch(() => setTemplates([]))
  }, [open])

  function insertAtCursor(token: string) {
    const ta = bodyRef.current
    if (!ta) {
      setBody((prev) => prev + token)
      return
    }
    const start = ta.selectionStart ?? body.length
    const end   = ta.selectionEnd ?? body.length
    const next = body.slice(0, start) + token + body.slice(end)
    setBody(next)
    requestAnimationFrame(() => {
      if (!bodyRef.current) return
      bodyRef.current.focus()
      const pos = start + token.length
      bodyRef.current.setSelectionRange(pos, pos)
    })
  }

  async function uploadAndAttach(file: File) {
    setUploadingFile(true)
    try {
      const att = await uploadAttachment(file)
      setAttachments((prev) => [...prev, att])
      toast.success(`Anexo carregado: ${att.name}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro no upload.')
    } finally {
      setUploadingFile(false)
    }
  }

  async function uploadAndInline(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('Só imagens são permitidas inline. Usa "Anexar ficheiro" para outros tipos.')
      return
    }
    setUploadingImage(true)
    try {
      const compressed = await compressImage(file)
      const att = await uploadAttachment(compressed)
      setInlineImages((prev) => [...prev, att])
      insertAtCursor(`[img:${att.url}]`)
      toast.success('Imagem inserida no corpo.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro no upload.')
    } finally {
      setUploadingImage(false)
    }
  }

  function handleBodyPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          e.preventDefault()
          uploadAndInline(file)
          return
        }
      }
    }
  }

  function removeInlineImage(idx: number) {
    const att = inlineImages[idx]
    setBody((prev) => prev.replace(`[img:${att.url}]`, ''))
    setInlineImages((prev) => prev.filter((_, i) => i !== idx))
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx))
  }

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
          user_instruction: aiInstruction.trim() || null,
          interactions: interactions.slice(0, 30).map((i) => ({
            type: i.type,
            direction: i.direction,
            subject: i.subject,
            content: i.content,
            occurred_at: i.occurred_at,
            metadata: i.metadata ?? null,
          })),
        }),
      })
      const raw = await readTextStream(res, (cumulative) => {
        const fields = extractJsonFields(cumulative)
        if (fields.subject !== null) setSubject(fields.subject)
        if (fields.body !== null) setBody(fields.body)
      })

      // Final parse to apply the fully-decoded values (escapes etc).
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try {
          const final = JSON.parse(jsonMatch[0]) as { subject?: string; body?: string }
          if (final.subject) setSubject(final.subject)
          if (final.body) setBody(final.body)
        } catch { /* progressive value already applied */ }
      }
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
      const final = await readTextStream(res, (cumulative) => {
        // Stream cleanup: strip the same preambles the old server-side
        // post-processor did — model usually obeys but be defensive.
        const cleaned = cumulative
          .replace(/^(here is|aqui está|aqui tem)[^\n]*\n+/i, '')
          .replace(/^```(?:[a-z]+)?\n/, '')
          .replace(/\n```$/, '')
          .trim()
        setBody(cleaned)
      })
      // Re-apply cleanup on the final string (in case the closing fence
      // arrived in the last chunk after the regex above already ran).
      const cleanedFinal = final
        .replace(/^(here is|aqui está|aqui tem)[^\n]*\n+/i, '')
        .replace(/^```(?:[a-z]+)?\n([\s\S]*?)\n```$/m, '$1')
        .trim()
      setBody(cleanedFinal)
      toast.success('Rascunho ajustado!')
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
          attachments: attachments.map((a) => ({ name: a.name, url: a.url, mime: a.mime, size: a.size })),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Erro desconhecido')
      toast.success('Email enviado!')
      onSent?.()
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
    setAiInstruction('')
    setInlineImages([])
    setAttachments([])
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
            <div className="space-y-2">
              <Textarea
                rows={2}
                value={aiInstruction}
                onChange={(e) => setAiInstruction(e.target.value)}
                placeholder="Instruções para a IA (opcional): ex. confirmar prazo, propor reunião, ser mais directo…"
                disabled={drafting}
                style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)', resize: 'none' }}
              />
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
                {(['pt-PT', 'en', 'es'] as const).map((lang) => (
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
                    {lang === 'pt-PT' ? 'PT' : lang === 'en' ? 'EN' : 'ES'}
                  </button>
                ))}
              </div>
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
              ref={bodyRef}
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onPaste={handleBodyPaste}
              placeholder={drafting ? 'A gerar…' : 'Escreve a mensagem aqui. Cola imagens diretamente para inseri-las no corpo.'}
              disabled={drafting}
              style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)', resize: 'none' }}
            />
          </div>

          {/* Inline image thumbnails */}
          {inlineImages.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
                Imagens inline ({inlineImages.length})
              </Label>
              <div className="flex flex-wrap gap-2">
                {inlineImages.map((img, idx) => (
                  <div
                    key={img.url}
                    className="relative rounded-md overflow-hidden"
                    style={{ width: 64, height: 64, border: '1px solid var(--border)' }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt={img.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button
                      onClick={() => removeInlineImage(idx)}
                      className="absolute top-0.5 right-0.5 rounded-full p-0.5"
                      style={{ background: 'rgba(0,0,0,0.6)' }}
                      title="Remover imagem"
                    >
                      <X className="h-3 w-3" style={{ color: '#fff' }} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
                Anexos ({attachments.length})
              </Label>
              <div className="space-y-1">
                {attachments.map((att, idx) => (
                  <div
                    key={att.url}
                    className="flex items-center gap-2 rounded-md px-2.5 py-1.5"
                    style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}
                  >
                    <Paperclip className="h-3 w-3 shrink-0" style={{ color: 'var(--muted-foreground)' }} />
                    <span className="text-[12px] truncate flex-1" style={{ color: 'var(--foreground)' }}>{att.name}</span>
                    <span className="text-[11px] shrink-0" style={{ color: 'var(--muted-foreground)' }}>
                      {formatBytes(att.size)}
                    </span>
                    <button onClick={() => removeAttachment(idx)} className="opacity-50 hover:opacity-100">
                      <X className="h-3 w-3" style={{ color: 'var(--muted-foreground)' }} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add attachment / image buttons */}
          <div className="flex gap-2 flex-wrap">
            <Button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingFile}
              variant="outline"
              className="h-9 gap-1.5 text-[12px]"
              style={{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--foreground)' }}
            >
              {uploadingFile
                ? <><Loader2 className="h-3 w-3 animate-spin" /> A carregar…</>
                : <><Paperclip className="h-3 w-3" /> Anexar ficheiro</>}
            </Button>
            <Button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={uploadingImage}
              variant="outline"
              className="h-9 gap-1.5 text-[12px]"
              style={{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--foreground)' }}
            >
              {uploadingImage
                ? <><Loader2 className="h-3 w-3 animate-spin" /> A carregar…</>
                : <><ImageIcon className="h-3 w-3" /> Inserir imagem</>}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                if (file.size > MAX_ATTACHMENT_BYTES) {
                  toast.error(`${file.name} excede 15MB.`)
                  return
                }
                uploadAndAttach(file)
              }}
            />
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                uploadAndInline(file)
              }}
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
