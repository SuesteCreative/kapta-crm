'use client'

import { useState, useRef, useCallback, useMemo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Upload, FileText, Image as ImageIcon, FileSpreadsheet, FileType, X, Loader2 } from 'lucide-react'
import { isWhatsAppFormat, parseWhatsAppChat, parsePlainConversation, type ParsedMessage } from '@/lib/parse-conversation'
import type { InteractionType, Direction } from '@/lib/database.types'

interface Props {
  open: boolean
  customerId: string
  onClose: () => void
}

type Tab = 'paste' | 'file'

interface MappedMessage {
  sender: string
  content: string
  occurred_at: string
  direction: Direction
}

interface UploadedFile {
  url: string
  name: string
  mime: string
  size: number
  ai_summary?: string | null
  csvPreview?: string[][]   // for CSV: first ~12 rows
}

const ACCEPT = '.txt,.png,.jpg,.jpeg,.csv,.xlsx,.xls,.pdf,image/*,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'

function mapMessages(parsed: ParsedMessage[], ownName: string): MappedMessage[] {
  const ownNames = ownName.split(',').map((n) => n.toLowerCase().trim()).filter(Boolean)
  return parsed.map((m) => ({
    ...m,
    direction: ownNames.some((n) => m.sender.toLowerCase().trim() === n || m.sender.toLowerCase().includes(n))
      ? 'outbound'
      : 'inbound',
  }))
}

function parseCsvPreview(text: string, maxRows = 12): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0).slice(0, maxRows)
  return lines.map((line) => {
    // Naive CSV split — handles quoted values minimally
    const out: string[] = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"' && line[i - 1] !== '\\') { inQuotes = !inQuotes; continue }
      if (ch === ',' && !inQuotes) { out.push(cur); cur = ''; continue }
      cur += ch
    }
    out.push(cur)
    return out
  })
}

function fileIcon(mime: string) {
  if (mime.startsWith('image/')) return ImageIcon
  if (mime === 'application/pdf') return FileType
  if (mime.includes('sheet') || mime.includes('excel') || mime === 'text/csv') return FileSpreadsheet
  return FileText
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function PasteConversationDialog({ open, customerId, onClose }: Props) {
  const [tab, setTab]               = useState<Tab>('paste')
  const [raw, setRaw]               = useState('')
  const [ownName, setOwnName]       = useState('Pedro')
  const [type, setType]             = useState<InteractionType>('whatsapp')
  const [loading, setLoading]       = useState(false)
  const [uploading, setUploading]   = useState(false)
  const [uploaded, setUploaded]     = useState<UploadedFile | null>(null)
  const fileInputRef                = useRef<HTMLInputElement>(null)

  const waFormat  = raw.trim().length > 0 && isWhatsAppFormat(raw)
  const parsed: ParsedMessage[] = raw.trim().length === 0
    ? []
    : waFormat
      ? parseWhatsAppChat(raw)
      : parsePlainConversation(raw)

  const mapped: MappedMessage[] = useMemo(() => mapMessages(parsed, ownName), [parsed, ownName])
  const outCount = mapped.filter((m) => m.direction === 'outbound').length
  const inCount  = mapped.length - outCount

  const onFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''   // reset so same file can be re-selected

    const isText = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt')
    const isCsv  = file.type === 'text/csv'  || file.name.toLowerCase().endsWith('.csv')

    if (isText) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const text = ev.target?.result
        if (typeof text === 'string') { setRaw(text); setTab('paste') }
      }
      reader.readAsText(file, 'utf-8')
      return
    }

    // Binary upload (image / pdf / xlsx / csv)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload/file', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? 'Upload failed')

      let csvPreview: string[][] | undefined
      if (isCsv) {
        const text = await file.text()
        csvPreview = parseCsvPreview(text)
      }

      setUploaded({
        url: json.url,
        name: json.name,
        mime: json.mime,
        size: json.size,
        ai_summary: json.ai_summary ?? null,
        csvPreview,
      })
      toast.success('Ficheiro carregado.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao carregar ficheiro.')
    } finally {
      setUploading(false)
    }
  }, [])

  async function handleImport() {
    setLoading(true)
    try {
      // Branch: file attachment OR parsed text
      if (uploaded) {
        const res = await fetch('/api/interactions/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id: customerId,
            interactions: [{
              type,
              direction: 'inbound' as Direction,
              content: uploaded.ai_summary ?? `Ficheiro: ${uploaded.name}`,
              occurred_at: new Date().toISOString(),
              subject: uploaded.name,
              metadata: {
                attachments: [{
                  name: uploaded.name,
                  mime: uploaded.mime,
                  size: uploaded.size,
                  url: uploaded.url,
                  ai_summary: uploaded.ai_summary,
                }],
              },
            }],
          }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) throw new Error(data.error ?? 'Erro')
        toast.success('Ficheiro importado!')
      } else if (mapped.length > 0) {
        const res = await fetch('/api/interactions/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id: customerId,
            interactions: mapped.map((m) => ({
              type,
              direction: m.direction,
              content: m.content,
              occurred_at: m.occurred_at,
            })),
          }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) throw new Error(data.error ?? 'Erro')
        toast.success(`${data.count} interações importadas!`)
      } else {
        return
      }
      setRaw('')
      setUploaded(null)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao importar.')
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    setRaw('')
    setUploaded(null)
    setTab('paste')
    onClose()
  }

  const Icon = uploaded ? fileIcon(uploaded.mime) : FileText
  const canImport = (uploaded || mapped.length > 0) && !loading && !uploading

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] flex flex-col"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--foreground)' }}>Importar conversa</DialogTitle>
        </DialogHeader>

        {/* Tab toggle */}
        <div
          className="flex rounded-lg p-0.5 gap-0.5 self-start"
          style={{ background: 'var(--muted)' }}
        >
          {(['paste', 'file'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3 py-1.5 text-[12.5px] font-medium rounded-md transition-colors"
              style={{
                background: tab === t ? 'var(--card)' : 'transparent',
                color: tab === t ? 'var(--foreground)' : 'var(--muted-foreground)',
                boxShadow: tab === t ? 'var(--shadow-card)' : 'none',
              }}
            >
              {t === 'paste' ? 'Colar texto' : 'Importar ficheiro'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Paste tab */}
          {tab === 'paste' && (
            <div className="space-y-2">
              <Textarea
                rows={12}
                placeholder="Cola aqui a conversa do WhatsApp ou outro texto..."
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                className="font-mono text-xs resize-none"
                style={{
                  background: 'var(--muted)',
                  border: '1px solid var(--border)',
                  color: 'var(--foreground)',
                }}
              />
              {raw.trim().length > 0 && (
                <p className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
                  Formato detetado:{' '}
                  <span style={{ color: waFormat ? '#2DB975' : 'var(--foreground)', fontWeight: 500 }}>
                    {waFormat ? 'WhatsApp' : 'Texto simples'}
                  </span>
                </p>
              )}
            </div>
          )}

          {/* File tab */}
          {tab === 'file' && !uploaded && (
            <div
              className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 cursor-pointer transition-colors hover:opacity-80"
              style={{ borderColor: 'var(--border)', background: 'var(--muted)' }}
              onClick={() => !uploading && fileInputRef.current?.click()}
            >
              {uploading
                ? <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--primary)' }} />
                : <Upload className="h-8 w-8" style={{ color: 'var(--muted-foreground)' }} />}
              <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                {uploading ? 'A carregar…' : 'Clica para escolher um ficheiro'}
              </p>
              <p className="text-[11.5px] text-center" style={{ color: 'var(--muted-foreground)' }}>
                Suportado: .txt (conversa) · imagens (.png .jpg .jpeg) · folhas (.csv .xlsx .xls) · .pdf
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={onFileChange}
              />
            </div>
          )}

          {/* Uploaded file preview */}
          {tab === 'file' && uploaded && (
            <div className="space-y-3">
              <div
                className="flex items-center gap-3 rounded-lg p-3"
                style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}
              >
                <div
                  className="w-9 h-9 rounded-md flex items-center justify-center shrink-0"
                  style={{ background: 'rgba(91,91,214,0.1)' }}
                >
                  <Icon className="h-4 w-4" style={{ color: 'var(--primary)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate" style={{ color: 'var(--foreground)' }}>
                    {uploaded.name}
                  </p>
                  <p className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
                    {uploaded.mime || '—'} · {formatBytes(uploaded.size)}
                  </p>
                </div>
                <button
                  onClick={() => setUploaded(null)}
                  className="rounded-md p-1.5 hover:bg-[var(--border)]"
                  title="Remover"
                >
                  <X className="h-3.5 w-3.5" style={{ color: 'var(--muted-foreground)' }} />
                </button>
              </div>

              {/* Viewer */}
              <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                {uploaded.mime.startsWith('image/') && (
                  <img
                    src={uploaded.url}
                    alt={uploaded.name}
                    className="w-full max-h-[400px] object-contain bg-black/5"
                  />
                )}
                {uploaded.mime === 'application/pdf' && (
                  <iframe
                    src={uploaded.url}
                    title={uploaded.name}
                    className="w-full"
                    style={{ height: 460, border: 'none' }}
                  />
                )}
                {uploaded.csvPreview && uploaded.csvPreview.length > 0 && (
                  <div className="overflow-auto" style={{ maxHeight: 320 }}>
                    <table className="w-full text-[11.5px]">
                      <tbody>
                        {uploaded.csvPreview.map((row, ri) => (
                          <tr key={ri} style={{ borderBottom: '1px solid var(--border)', background: ri === 0 ? 'var(--muted)' : 'transparent' }}>
                            {row.map((cell, ci) => (
                              <td key={ci} className="px-2 py-1.5 align-top whitespace-nowrap" style={{ color: ri === 0 ? 'var(--foreground)' : 'var(--muted-foreground)', fontWeight: ri === 0 ? 600 : 400 }}>
                                {cell.slice(0, 80)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {(uploaded.mime.includes('sheet') || uploaded.mime.includes('excel')) && !uploaded.csvPreview && (
                  <div className="p-4 text-center space-y-2" style={{ background: 'var(--muted)' }}>
                    <FileSpreadsheet className="h-8 w-8 mx-auto" style={{ color: 'var(--muted-foreground)' }} />
                    <p className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
                      Pré-visualização indisponível para Excel.
                    </p>
                    <a
                      href={uploaded.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-[12px] font-medium"
                      style={{ color: 'var(--primary)' }}
                    >
                      Abrir em nova aba
                    </a>
                  </div>
                )}
              </div>

              {uploaded.ai_summary && (
                <div className="rounded-lg p-3 text-[12px]" style={{ background: 'rgba(91,91,214,0.06)', border: '1px solid rgba(91,91,214,0.2)', color: 'var(--foreground)' }}>
                  <p className="font-medium mb-1" style={{ color: 'var(--primary)' }}>Resumo IA</p>
                  {uploaded.ai_summary}
                </div>
              )}
            </div>
          )}

          {/* Config row */}
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-[140px] space-y-1.5">
              <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
                O teu nome (separar vários por vírgula)
              </Label>
              <Input
                value={ownName}
                onChange={(e) => setOwnName(e.target.value)}
                placeholder="Pedro, Kapta Media"
                style={{
                  background: 'var(--muted)',
                  border: '1px solid var(--border)',
                  color: 'var(--foreground)',
                  height: '36px',
                }}
                disabled={!!uploaded}
              />
            </div>
            <div className="flex-1 min-w-[140px] space-y-1.5">
              <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
                Tipo de interação
              </Label>
              <Select value={type} onValueChange={(v) => setType(v as InteractionType)}>
                <SelectTrigger style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)', height: '36px' }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="note">Nota</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Conversation preview (only when no file uploaded) */}
          {!uploaded && mapped.length > 0 && (
            <div className="space-y-2">
              <p className="text-[12px] font-medium" style={{ color: 'var(--foreground)' }}>
                {mapped.length} mensagens detetadas
                {mapped.length > 1 && ` (${inCount} recebidas, ${outCount} enviadas)`}
                {mapped.length > 200 && (
                  <span className="ml-2 text-amber-400 font-normal">
                    · atenção: conversa longa
                  </span>
                )}
              </p>
              <div
                className="rounded-xl overflow-y-auto max-h-48 space-y-1.5 p-3"
                style={{ background: 'var(--muted)' }}
              >
                {mapped.slice(0, 50).map((m, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-[11.5px]">
                    <span
                      className="rounded-full px-1.5 py-0.5 shrink-0 font-medium"
                      style={{
                        background: m.direction === 'outbound' ? 'rgba(91,91,214,0.12)' : 'rgba(45,185,117,0.12)',
                        color: m.direction === 'outbound' ? 'var(--primary)' : '#2DB975',
                      }}
                    >
                      {m.direction === 'outbound' ? '↑ enviado' : '↓ recebido'}
                    </span>
                    <span style={{ color: 'var(--muted-foreground)' }} className="shrink-0">
                      {new Date(m.occurred_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="truncate" style={{ color: 'var(--foreground)' }}>
                      <span className="font-medium">{m.sender}: </span>
                      {m.content.slice(0, 100)}{m.content.length > 100 ? '…' : ''}
                    </span>
                  </div>
                ))}
                {mapped.length > 50 && (
                  <p className="text-[11px] text-center pt-1" style={{ color: 'var(--muted-foreground)' }}>
                    + {mapped.length - 50} mensagens não mostradas na pré-visualização
                  </p>
                )}
              </div>
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
            onClick={handleImport}
            disabled={!canImport}
            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            {loading
              ? 'A importar…'
              : uploaded
                ? 'Importar ficheiro'
                : `Importar ${mapped.length > 0 ? mapped.length : ''} mensagens`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
