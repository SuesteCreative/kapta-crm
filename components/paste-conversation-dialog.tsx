'use client'

import { useState, useRef, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Upload } from 'lucide-react'
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

function mapMessages(parsed: ParsedMessage[], ownName: string): MappedMessage[] {
  // Support comma-separated names: "Pedro, Kapta Media"
  const ownNames = ownName.split(',').map((n) => n.toLowerCase().trim()).filter(Boolean)
  return parsed.map((m) => ({
    ...m,
    direction: ownNames.some((n) => m.sender.toLowerCase().trim() === n || m.sender.toLowerCase().includes(n))
      ? 'outbound'
      : 'inbound',
  }))
}

export function PasteConversationDialog({ open, customerId, onClose }: Props) {
  const [tab, setTab]             = useState<Tab>('paste')
  const [raw, setRaw]             = useState('')
  const [ownName, setOwnName]     = useState('Pedro')
  const [type, setType]           = useState<InteractionType>('whatsapp')
  const [loading, setLoading]     = useState(false)
  const fileInputRef              = useRef<HTMLInputElement>(null)

  const waFormat  = raw.trim().length > 0 && isWhatsAppFormat(raw)
  const parsed: ParsedMessage[] = raw.trim().length === 0
    ? []
    : waFormat
      ? parseWhatsAppChat(raw)
      : parsePlainConversation(raw)

  const mapped: MappedMessage[] = mapMessages(parsed, ownName)
  const outCount = mapped.filter((m) => m.direction === 'outbound').length
  const inCount  = mapped.length - outCount

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result
      if (typeof text === 'string') {
        setRaw(text)
        setTab('paste')
      }
    }
    reader.readAsText(file, 'utf-8')
    // Reset so same file can be re-selected
    e.target.value = ''
  }, [])

  async function handleImport() {
    if (mapped.length === 0) return
    setLoading(true)
    try {
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
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Erro desconhecido')
      toast.success(`${data.count} interações importadas!`)
      setRaw('')
      onClose()
    } catch (err) {
      toast.error('Erro ao importar conversa.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    setRaw('')
    setTab('paste')
    onClose()
  }

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
          {tab === 'file' && (
            <div
              className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 cursor-pointer transition-colors hover:opacity-80"
              style={{ borderColor: 'var(--border)', background: 'var(--muted)' }}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-8 w-8" style={{ color: 'var(--muted-foreground)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                Clica para escolher um ficheiro .txt
              </p>
              <p className="text-[11.5px]" style={{ color: 'var(--muted-foreground)' }}>
                Exporta a conversa do WhatsApp: Abrir chat → Menu → Exportar conversa
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt"
                className="hidden"
                onChange={onFileChange}
              />
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

          {/* Preview */}
          {mapped.length > 0 && (
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
            disabled={mapped.length === 0 || loading}
            style={{ background: 'var(--primary)', color: '#fff' }}
          >
            {loading ? 'A importar…' : `Importar ${mapped.length > 0 ? mapped.length : ''} mensagens`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
