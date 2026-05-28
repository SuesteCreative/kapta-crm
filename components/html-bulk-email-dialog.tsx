'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Upload, Eye, Send, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { RecipientPicker, type Recipient } from '@/components/recipient-picker'

interface Props {
  open: boolean
  onClose: () => void
}

interface SendResult {
  email: string
  customer_id: string | null
  ok: boolean
  error?: string
}

export function HtmlBulkEmailDialog({ open, onClose }: Props) {
  const [subject, setSubject]       = useState('')
  const [html, setHtml]             = useState('')
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [previewOpen, setPreviewOpen] = useState(false)
  const [loading, setLoading]       = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [results, setResults]       = useState<SendResult[] | null>(null)
  const fileInputRef                = useRef<HTMLInputElement>(null)

  function handleClose() {
    if (loading) return
    setSubject('')
    setHtml('')
    setRecipients([])
    setPreviewOpen(false)
    setConfirmOpen(false)
    setResults(null)
    onClose()
  }

  function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!/\.html?$/i.test(file.name)) {
      toast.error('Ficheiro deve ser .html')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const content = String(reader.result ?? '')
      setHtml(content)
      toast.success(`${file.name} carregado (${content.length} chars)`)
    }
    reader.onerror = () => toast.error('Erro ao ler ficheiro')
    reader.readAsText(file)
    e.target.value = ''
  }

  async function handleSend() {
    if (recipients.length === 0) { toast.error('Adiciona pelo menos 1 destinatário'); return }
    if (!subject.trim())         { toast.error('Falta assunto'); return }
    if (!html.trim())            { toast.error('Falta HTML'); return }

    setLoading(true)
    setResults(null)
    try {
      const res = await fetch('/api/email/send-html-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: recipients.map((r) => ({
            email: r.email,
            customer_id: r.customer_id ?? null,
            name: r.name ?? null,
          })),
          subject,
          html,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Erro desconhecido')
      setResults(data.results as SendResult[])
      if (data.failed === 0) {
        toast.success(`${data.sent} email(s) enviado(s)!`)
      } else {
        toast.warning(`${data.sent} enviados, ${data.failed} falharam`)
      }
    } catch (err) {
      toast.error(`Erro: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
      setConfirmOpen(false)
    }
  }

  const canSend = recipients.length > 0 && subject.trim().length > 0 && html.trim().length > 0

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
        <DialogContent
          className="max-w-3xl max-h-[90vh] overflow-y-auto"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <DialogHeader>
            <DialogTitle style={{ color: 'var(--foreground)' }}>
              Envio bulk HTML (BCC-safe / GDPR)
            </DialogTitle>
            <p className="text-[12px] mt-1" style={{ color: 'var(--muted-foreground)' }}>
              Cada destinatário recebe email individual (sem ver os outros). Customers do CRM ficam logados como interaction.
            </p>
          </DialogHeader>

          <div className="space-y-4">
            <RecipientPicker
              label={`Destinatários (${recipients.length})`}
              value={recipients}
              onChange={setRecipients}
              placeholder="email@cliente.com"
            />

            <div className="space-y-1.5">
              <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>Assunto</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Assunto do email"
                style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>HTML</Label>
                <div className="flex gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".html,.htm,text/html"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    style={{ border: '1px solid var(--border)', color: 'var(--foreground)', background: 'transparent' }}
                    className="h-7 text-[11.5px]"
                  >
                    <Upload className="h-3 w-3 mr-1" />
                    Upload .html
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPreviewOpen(true)}
                    disabled={!html.trim()}
                    style={{ border: '1px solid var(--border)', color: 'var(--foreground)', background: 'transparent' }}
                    className="h-7 text-[11.5px]"
                  >
                    <Eye className="h-3 w-3 mr-1" />
                    Preview
                  </Button>
                </div>
              </div>
              <Textarea
                rows={12}
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                placeholder="<!DOCTYPE html>... cola aqui ou faz upload"
                spellCheck={false}
                style={{
                  background: 'var(--muted)',
                  border: '1px solid var(--border)',
                  color: 'var(--foreground)',
                  resize: 'vertical',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
                  fontSize: '11.5px',
                }}
              />
              <div className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
                {html.length} chars · sem assinatura auto (HTML enviado tal-qual)
              </div>
            </div>

            {results && (
              <div className="space-y-1.5">
                <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
                  Resultados
                </Label>
                <div
                  className="rounded-lg p-2 max-h-48 overflow-y-auto text-[11.5px] font-mono"
                  style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}
                >
                  {results.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 py-0.5"
                      style={{ color: r.ok ? 'var(--foreground)' : '#dc2626' }}
                    >
                      <span>{r.ok ? '✓' : '✗'}</span>
                      <span className="flex-1 truncate">{r.email}</span>
                      {!r.ok && <span className="opacity-70 truncate">{r.error}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={loading}
              style={{ border: '1px solid var(--border)', color: 'var(--foreground)', background: 'transparent' }}
            >
              Fechar
            </Button>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={loading || !canSend}
              style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              {loading
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />A enviar…</>
                : <><Send className="h-3.5 w-3.5 mr-1.5" />Enviar a {recipients.length}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent
          className="max-w-4xl max-h-[92vh] p-0 overflow-hidden"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <DialogHeader className="px-5 pt-5">
            <DialogTitle style={{ color: 'var(--foreground)' }}>
              Preview · {subject || '(sem assunto)'}
            </DialogTitle>
            <p className="text-[11.5px]" style={{ color: 'var(--muted-foreground)' }}>
              Renderizado em iframe sandbox. Imagens externas carregam normalmente.
            </p>
          </DialogHeader>
          <div className="px-5 pb-5">
            <iframe
              title="email-preview"
              sandbox="allow-same-origin"
              srcDoc={html}
              style={{
                width: '100%',
                height: '70vh',
                background: '#fff',
                border: '1px solid var(--border)',
                borderRadius: 8,
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Send confirmation */}
      <Dialog open={confirmOpen} onOpenChange={(o) => !loading && setConfirmOpen(o)}>
        <DialogContent
          className="max-w-md"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" style={{ color: 'var(--foreground)' }}>
              <AlertTriangle className="h-4 w-4" style={{ color: '#f59e0b' }} />
              Confirmar envio
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-[13px]" style={{ color: 'var(--foreground)' }}>
            <p>Enviar para <strong>{recipients.length}</strong> destinatário(s):</p>
            <div
              className="rounded-md p-2 max-h-32 overflow-y-auto text-[11.5px]"
              style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}
            >
              {recipients.map((r) => r.email).join(', ')}
            </div>
            <p style={{ color: 'var(--muted-foreground)' }} className="text-[11.5px]">
              Assunto: <strong>{subject}</strong>
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={loading}
              style={{ border: '1px solid var(--border)', color: 'var(--foreground)', background: 'transparent' }}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSend}
              disabled={loading}
              style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              {loading
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />A enviar…</>
                : <>Confirmar e enviar</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
