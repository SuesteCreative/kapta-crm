'use client'

import { useState, useRef, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ExternalLink, ImagePlus, X, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

function titleFromBubblesUrl(url: string): string {
  try {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
    return slug
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  } catch {
    return ''
  }
}

async function toWebP(file: File, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const MAX = 1920
      let w = img.naturalWidth
      let h = img.naturalHeight
      if (w > MAX || h > MAX) {
        const r = Math.min(MAX / w, MAX / h)
        w = Math.round(w * r)
        h = Math.round(h * r)
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
        'image/webp',
        quality
      )
    }
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Image load failed')) }
    img.src = objectUrl
  })
}

interface Props { open: boolean; customerId: string; onClose: () => void }

export function AddInteractionDialog({ open, customerId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    type: 'email' as 'email' | 'whatsapp' | 'meeting' | 'call' | 'note',
    direction: 'inbound' as 'inbound' | 'outbound' | '',
    subject: '',
    content: '',
    bubbles_url: '',
    bubbles_title: '',
    occurred_at: new Date().toISOString().slice(0, 16),
  })

  const [images, setImages] = useState<{ url: string; preview: string }[]>([])
  const [uploadingCount, setUploadingCount] = useState(0)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isMeeting = form.type === 'meeting'
  const isNote = form.type === 'note'

  const uploadFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'))
    if (imageFiles.length === 0) return

    setUploadingCount((n) => n + imageFiles.length)

    for (const file of imageFiles) {
      const preview = URL.createObjectURL(file)
      try {
        const webp = await toWebP(file)
        const fd = new FormData()
        fd.append('file', new File([webp], 'image.webp', { type: 'image/webp' }))
        const res = await fetch('/api/upload/image', { method: 'POST', body: fd })
        const json = await res.json()
        if (!json.url) throw new Error(json.error ?? 'Upload failed')
        setImages((prev) => [...prev, { url: json.url, preview }])
      } catch (err) {
        URL.revokeObjectURL(preview)
        toast.error('Erro ao carregar imagem', { description: String(err) })
      } finally {
        setUploadingCount((n) => n - 1)
      }
    }
  }, [])

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    uploadFiles(files)
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    uploadFiles(Array.from(e.dataTransfer.files))
  }

  function handlePaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean) as File[]
    if (files.length > 0) uploadFiles(files)
  }

  function removeImage(idx: number) {
    setImages((prev) => {
      const next = [...prev]
      URL.revokeObjectURL(next[idx].preview)
      next.splice(idx, 1)
      return next
    })
  }

  function reset() {
    images.forEach((img) => URL.revokeObjectURL(img.preview))
    setImages([])
    setUploadingCount(0)
    setForm({
      type: 'email', direction: 'inbound', subject: '', content: '',
      bubbles_url: '', bubbles_title: '', occurred_at: new Date().toISOString().slice(0, 16),
    })
  }

  function handleClose() { reset(); onClose() }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    if (uploadingCount > 0) { toast.error('Aguarda o upload das imagens.'); return }
    setLoading(true)
    try {
      const imageUrls = images.map((img) => img.url)
      const { error } = await supabase.from('interactions').insert({
        customer_id: customerId,
        type: form.type,
        direction: (isNote || isMeeting) ? null : (form.direction || null),
        subject: form.subject || null,
        content: form.content || null,
        bubbles_url: form.bubbles_url || null,
        bubbles_title: form.bubbles_title || null,
        occurred_at: new Date(form.occurred_at).toISOString(),
        metadata: imageUrls.length > 0 ? { images: imageUrls } : null,
      })
      if (error) throw error
      toast.success('Interação adicionada!')
      reset()
      onClose()
    } catch {
      toast.error('Erro ao adicionar interação.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova interação</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} onPaste={handlePaste} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as typeof form.type })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="meeting">Reunião</SelectItem>
                  <SelectItem value="call">Chamada</SelectItem>
                  <SelectItem value="note">Nota</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!isNote && !isMeeting && (
              <div className="space-y-1.5">
                <Label>Direção</Label>
                <Select value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v as typeof form.direction })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inbound">Recebido</SelectItem>
                    <SelectItem value="outbound">Enviado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Data e hora</Label>
            <Input type="datetime-local" value={form.occurred_at} onChange={(e) => setForm({ ...form, occurred_at: e.target.value })} />
          </div>

          {!isNote && (
            <div className="space-y-1.5">
              <Label>Assunto</Label>
              <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder={isMeeting ? 'Título da reunião' : 'Assunto'} />
            </div>
          )}

          {isMeeting && (
            <>
              <div className="space-y-1.5">
                <Label>Link Bubbles (opcional)</Label>
                <div className="flex gap-2">
                  <Input
                    value={form.bubbles_url}
                    onChange={(e) => {
                      const url = e.target.value
                      const title = url.includes('usebubbles.com') ? titleFromBubblesUrl(url) : ''
                      setForm({
                        ...form,
                        bubbles_url: url,
                        bubbles_title: title || form.bubbles_title,
                        subject: form.subject || title,
                      })
                    }}
                    placeholder="https://app.usebubbles.com/..."
                  />
                  {form.bubbles_url && (
                    <a
                      href={form.bubbles_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="h-10 w-10 flex items-center justify-center rounded-lg shrink-0 transition-opacity hover:opacity-70"
                      style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--muted-foreground)' }}
                      title="Abrir no Bubbles"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
                {form.bubbles_url && (
                  <p className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
                    Abre o Bubbles → copia o resumo → cola no campo abaixo
                  </p>
                )}
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label>{isNote ? 'Nota' : 'Conteúdo / Resumo'}</Label>
            <Textarea
              rows={5}
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder={isNote ? 'Escreve a tua nota aqui…' : isMeeting ? 'Resumo ou transcrição da reunião…' : 'Conteúdo da mensagem…'}
            />
          </div>

          {/* Image upload */}
          <div className="space-y-2">
            <Label>Imagens (opcional)</Label>

            {/* Drop zone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-3 cursor-pointer transition-colors text-[13px]"
              style={{
                borderColor: dragging ? 'var(--primary)' : 'var(--border)',
                background: dragging ? 'rgba(91,91,214,0.05)' : 'transparent',
                color: 'var(--muted-foreground)',
              }}
            >
              <ImagePlus className="h-4 w-4 shrink-0" />
              <span>Clica, arrasta ou cola imagens aqui</span>
              {uploadingCount > 0 && (
                <Loader2 className="h-3.5 w-3.5 animate-spin ml-1" />
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileInput}
            />

            {/* Previews */}
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {images.map((img, idx) => (
                  <div key={idx} className="relative group">
                    <img
                      src={img.preview}
                      alt=""
                      className="rounded-lg object-cover"
                      style={{ width: 80, height: 60 }}
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(idx)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: 'var(--destructive)', color: '#fff' }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>Cancelar</Button>
            <Button type="submit" disabled={loading || uploadingCount > 0}>
              {loading ? 'A guardar…' : uploadingCount > 0 ? `A carregar (${uploadingCount})…` : 'Guardar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
