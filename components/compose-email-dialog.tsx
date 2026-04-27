'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sparkles, Loader2, Paperclip, Image as ImageIcon, X, ChevronDown, ChevronUp, Save, AlertTriangle, Wand2 } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { RecipientPicker, type Recipient } from '@/components/recipient-picker'
import { uploadAttachment, type UploadedAttachment, MAX_ATTACHMENT_BYTES } from '@/lib/upload-attachment'

interface PromptPreset {
  id: string
  name: string
  body: string
}

export interface ComposeInitialState {
  to?: Recipient[]
  cc?: Recipient[]
  bcc?: Recipient[]
  subject?: string
  body?: string
  prompt?: string
}

interface Props {
  open: boolean
  onClose: () => void
  draftId?: string | null
  initialState?: ComposeInitialState | null
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const INTERNAL_DOMAIN = 'kapta.pt'

function isInternal(email: string): boolean {
  return email.toLowerCase().endsWith(`@${INTERNAL_DOMAIN}`)
}

function classifyRecipients(all: Recipient[]): { internal: number; external: number; externals: string[]; internals: string[] } {
  let internal = 0
  let external = 0
  const externals: string[] = []
  const internals: string[] = []
  for (const r of all) {
    if (isInternal(r.email)) {
      internal++
      internals.push(r.email)
    } else {
      external++
      externals.push(r.email)
    }
  }
  return { internal, external, externals, internals }
}

export function ComposeEmailDialog({ open, onClose, draftId: initialDraftId = null, initialState = null }: Props) {
  const router = useRouter()
  const [to, setTo]                       = useState<Recipient[]>([])
  const [cc, setCc]                       = useState<Recipient[]>([])
  const [bcc, setBcc]                     = useState<Recipient[]>([])
  const [showCcBcc, setShowCcBcc]         = useState(false)
  const [prompt, setPrompt]               = useState('')
  const [language, setLanguage]           = useState<'pt-PT' | 'en'>('pt-PT')
  const [subject, setSubject]             = useState('')
  const [body, setBody]                   = useState('')
  const [refineInput, setRefineInput]     = useState('')
  const [drafting, setDrafting]           = useState(false)
  const [refining, setRefining]           = useState(false)
  const [sending, setSending]             = useState(false)
  const [inlineImages, setInlineImages]   = useState<UploadedAttachment[]>([])
  const [attachments, setAttachments]     = useState<UploadedAttachment[]>([])
  const [uploadingFile, setUploadingFile] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [draftId, setDraftId]             = useState<string | null>(initialDraftId)
  const [savingDraft, setSavingDraft]     = useState(false)
  const [loadingDraft, setLoadingDraft]   = useState(false)
  const [presets, setPresets]             = useState<PromptPreset[]>([])

  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  function reset() {
    setTo([]); setCc([]); setBcc([]); setShowCcBcc(false)
    setPrompt(''); setSubject(''); setBody(''); setRefineInput('')
    setInlineImages([]); setAttachments([])
    setLanguage('pt-PT')
    setDraftId(null)
  }

  function handleClose() {
    reset()
    onClose()
  }

  // Load draft when dialog opens with a draftId
  useEffect(() => {
    if (!open) return
    if (!initialDraftId) return
    setLoadingDraft(true)
    fetch(`/api/email/drafts/${initialDraftId}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok || !json.draft) return
        const d = json.draft
        setDraftId(d.id)
        setTo((d.to_recipients ?? []) as Recipient[])
        setCc((d.cc_recipients ?? []) as Recipient[])
        setBcc((d.bcc_recipients ?? []) as Recipient[])
        setShowCcBcc(((d.cc_recipients ?? []).length + (d.bcc_recipients ?? []).length) > 0)
        setSubject(d.subject ?? '')
        setBody(d.body ?? '')
        setPrompt(d.prompt ?? '')
        setLanguage((d.language as 'pt-PT' | 'en') ?? 'pt-PT')
        setAttachments((d.attachments ?? []) as UploadedAttachment[])
        setInlineImages((d.inline_images ?? []) as UploadedAttachment[])
      })
      .finally(() => setLoadingDraft(false))
  }, [open, initialDraftId])

  // Load prompt presets when dialog opens
  useEffect(() => {
    if (!open) return
    supabase
      .from('templates')
      .select('id, name, body')
      .eq('type', 'compose-prompt')
      .order('name')
      .then(({ data }) => setPresets((data ?? []) as PromptPreset[]))
  }, [open])

  function applyPreset(id: string) {
    const p = presets.find((x) => x.id === id)
    if (!p) return
    setPrompt(p.body)
    toast.success(`Preset aplicado: ${p.name}`)
  }

  // Apply initialState (for Reply All / Forward) when provided and no draft is loading
  useEffect(() => {
    if (!open || initialDraftId || !initialState) return
    if (initialState.to)      setTo(initialState.to)
    if (initialState.cc)      setCc(initialState.cc)
    if (initialState.bcc)     setBcc(initialState.bcc)
    if (initialState.subject) setSubject(initialState.subject)
    if (initialState.body)    setBody(initialState.body)
    if (initialState.prompt)  setPrompt(initialState.prompt)
    if ((initialState.cc?.length ?? 0) + (initialState.bcc?.length ?? 0) > 0) setShowCcBcc(true)
  }, [open, initialDraftId, initialState])

  async function handleSaveDraft() {
    if (to.length === 0 && !subject.trim() && !body.trim() && !prompt.trim()) {
      toast.error('Nada para guardar.')
      return
    }
    setSavingDraft(true)
    try {
      const res = await fetch('/api/email/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: draftId ?? undefined,
          primary_customer_id: to.find((r) => r.customer_id)?.customer_id ?? null,
          to_recipients:  to,
          cc_recipients:  cc,
          bcc_recipients: bcc,
          subject,
          body,
          prompt,
          language,
          attachments,
          inline_images: inlineImages,
        }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Erro')
      setDraftId(json.id)
      toast.success('Rascunho guardado.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao guardar rascunho.')
    } finally {
      setSavingDraft(false)
    }
  }

  async function deleteDraftIfAny() {
    if (!draftId) return
    try {
      await fetch(`/api/email/drafts/${draftId}`, { method: 'DELETE' })
    } catch {
      // best-effort
    }
  }

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
    // restore caret after the inserted token
    requestAnimationFrame(() => {
      if (!bodyRef.current) return
      bodyRef.current.focus()
      const pos = start + token.length
      bodyRef.current.setSelectionRange(pos, pos)
    })
  }

  async function handleDraftWithAI() {
    if (!prompt.trim()) {
      toast.error('Escreve primeiro um prompt para a IA.')
      return
    }
    if (to.length === 0) {
      toast.error('Adiciona pelo menos um destinatário.')
      return
    }
    setDrafting(true)
    try {
      const res = await fetch('/api/ai/compose-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          language,
          recipients: to.map((r) => ({
            email: r.email,
            name: r.name,
            company: r.company ?? null,
            customer_id: r.customer_id ?? null,
          })),
        }),
      })
      const json = await res.json()
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
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Erro')
      if (json.body) { setBody(json.body); toast.success('Rascunho ajustado!') }
      setRefineInput('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao ajustar.')
    } finally {
      setRefining(false)
    }
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
      const att = await uploadAttachment(file)
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

  function confirmMixIfAny(): boolean {
    const all = [...to, ...cc, ...bcc]
    const { internal, external, externals, internals } = classifyRecipients(all)
    if (internal === 0 || external === 0) return true
    const lines = [
      `Vais enviar para ${external} destinatário${external !== 1 ? 's' : ''} externo${external !== 1 ? 's' : ''} (${externals.slice(0, 3).join(', ')}${externals.length > 3 ? '…' : ''})`,
      `e ${internal} interno${internal !== 1 ? 's' : ''} (${internals.slice(0, 3).join(', ')}${internals.length > 3 ? '…' : ''}).`,
      '',
      'Tens a certeza?',
    ].join('\n')
    return window.confirm(lines)
  }

  async function handleSend() {
    if (to.length === 0 || !subject.trim() || !body.trim()) {
      toast.error('Preenche destinatários, assunto e corpo.')
      return
    }
    if (!confirmMixIfAny()) return
    setSending(true)
    try {
      const primary = to.find((r) => r.customer_id)?.customer_id ?? null
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: primary,
          to:  to.map((r) => r.email),
          cc:  cc.map((r) => r.email),
          bcc: bcc.map((r) => r.email),
          subject,
          body,
          attachments: attachments.map((a) => ({ name: a.name, url: a.url, mime: a.mime, size: a.size })),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Erro')
      await deleteDraftIfAny()
      toast.success('Email enviado!')
      handleClose()
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao enviar.')
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent
        className="max-w-2xl max-h-[92vh] flex flex-col"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--foreground)' }}>Novo email</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          <RecipientPicker label="Para" value={to} onChange={setTo} autoFocus />

          <button
            onClick={() => setShowCcBcc((v) => !v)}
            className="flex items-center gap-1 text-[12px] font-medium hover:opacity-70"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {showCcBcc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showCcBcc ? 'Ocultar CC / BCC' : 'Adicionar CC / BCC'}
          </button>

          {showCcBcc && (
            <>
              <RecipientPicker label="CC"  value={cc}  onChange={setCc} />
              <RecipientPicker label="BCC" value={bcc} onChange={setBcc} />
            </>
          )}

          {/* Mix warning */}
          {(() => {
            const { internal, external } = classifyRecipients([...to, ...cc, ...bcc])
            if (internal === 0 || external === 0) return null
            return (
              <div
                className="rounded-lg p-3 flex items-start gap-2"
                style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}
              >
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: '#B45309' }} />
                <p className="text-[12px]" style={{ color: 'var(--foreground)' }}>
                  <strong>Mistura interna + externa:</strong> tens {external} externo{external !== 1 ? 's' : ''} e {internal} interno{internal !== 1 ? 's' : ''} nas listas. O cliente externo vê os emails internos no CC. Confirma antes de enviar.
                </p>
              </div>
            )
          })()}

          {/* Prompt + AI button */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
                Diz à IA o que queres dizer
              </Label>
              {presets.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Wand2 className="h-3 w-3" style={{ color: 'var(--muted-foreground)' }} />
                  <Select onValueChange={applyPreset}>
                    <SelectTrigger
                      className="h-7 text-[11.5px] gap-1"
                      style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)', minWidth: 180 }}
                    >
                      <SelectValue placeholder="Preset…" />
                    </SelectTrigger>
                    <SelectContent>
                      {presets.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <Textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ex: Quero confirmar a reunião de quinta às 14h e perguntar se já têm os requisitos."
              className="resize-none"
              style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            />
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleDraftWithAI}
              disabled={drafting || !prompt.trim() || to.length === 0}
              className="flex-1 h-9 gap-2 rounded-lg text-[13px] font-medium"
              style={{ background: 'rgba(91,91,214,0.1)', color: 'var(--primary)', border: '1px solid rgba(91,91,214,0.25)' }}
            >
              {drafting
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> A gerar rascunho…</>
                : <><Sparkles className="h-3.5 w-3.5" /> Gerar email com IA</>}
            </Button>
            <div className="flex items-center rounded-lg overflow-hidden shrink-0" style={{ border: '1px solid rgba(91,91,214,0.25)' }}>
              {(['pt-PT', 'en'] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setLanguage(lang)}
                  disabled={drafting}
                  className="h-9 px-3 text-[12px] font-semibold"
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
            <p className="text-[10.5px]" style={{ color: 'var(--muted-foreground)' }}>
              Imagens inline: cola direto ou usa o botão abaixo. A assinatura é adicionada automaticamente.
            </p>
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

          {/* Refine with AI */}
          {body.trim() && (
            <div className="flex gap-2">
              <input
                className="flex-1 h-9 rounded-lg px-3 text-sm outline-none"
                style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                placeholder="Ajustar: ex. mais curto, adicionar link Calendly, tom mais informal…"
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
            style={{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--foreground)' }}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleSaveDraft}
            disabled={savingDraft || sending}
            className="gap-1.5"
            style={{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--foreground)' }}
          >
            {savingDraft
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> A guardar…</>
              : <><Save className="h-3.5 w-3.5" /> {draftId ? 'Atualizar rascunho' : 'Guardar rascunho'}</>}
          </Button>
          <Button
            onClick={handleSend}
            disabled={sending || drafting || to.length === 0 || !subject.trim() || !body.trim()}
            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            {sending ? 'A enviar…' : 'Enviar email'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
