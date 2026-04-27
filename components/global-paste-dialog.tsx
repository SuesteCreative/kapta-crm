'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Search, CheckCircle2, X, Phone, UserSearch } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import {
  isWhatsAppFormat, parseWhatsAppChat, parsePlainConversation, extractPhoneFromHeader,
  type ParsedMessage,
} from '@/lib/parse-conversation'
import type { InteractionType, Direction } from '@/lib/database.types'

interface CustomerOption {
  id: string
  name: string
  company: string | null
}

interface MatchedCustomer {
  customer_id: string
  name: string
  company: string | null
}

interface MappedMessage {
  sender: string
  content: string
  occurred_at: string
  direction: Direction
}

function mapMessages(parsed: ParsedMessage[], ownName: string): MappedMessage[] {
  const ownNames = ownName.split(',').map((n) => n.toLowerCase().trim()).filter(Boolean)
  return parsed.map((m) => ({
    ...m,
    direction: ownNames.some((n) => m.sender.toLowerCase().trim() === n || m.sender.toLowerCase().includes(n))
      ? 'outbound'
      : 'inbound',
  }))
}

interface Props {
  open: boolean
  onClose: () => void
}

export function GlobalPasteDialog({ open, onClose }: Props) {
  const router = useRouter()
  const [raw, setRaw]                       = useState('')
  const [ownName, setOwnName]               = useState('Pedro')
  const [type, setType]                     = useState<InteractionType>('whatsapp')
  const [loading, setLoading]               = useState(false)
  const [matching, setMatching]             = useState(false)
  const [matched, setMatched]               = useState<MatchedCustomer | null>(null)
  const [detectedPhone, setDetectedPhone]   = useState<string | null>(null)
  const [manualSearch, setManualSearch]     = useState(false)
  const [query, setQuery]                   = useState('')
  const [customers, setCustomers]           = useState<CustomerOption[]>([])

  const matchAttemptRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open) return
    setRaw(''); setMatched(null); setDetectedPhone(null); setManualSearch(false); setQuery('')
    matchAttemptRef.current = null
    supabase
      .from('customers')
      .select('id, name, company')
      .order('name')
      .then(({ data }) => setCustomers((data ?? []) as CustomerOption[]))
  }, [open])

  // Auto-detect phone + match customer when user pastes
  useEffect(() => {
    if (!open || raw.trim().length < 20 || matched) return
    const phone = extractPhoneFromHeader(raw)
    if (!phone) {
      setDetectedPhone(null)
      return
    }
    if (matchAttemptRef.current === phone) return
    matchAttemptRef.current = phone
    setDetectedPhone(phone)
    setMatching(true)
    fetch('/api/customers/match-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && json.match) {
          setMatched(json.match as MatchedCustomer)
        }
      })
      .catch(() => { /* silent */ })
      .finally(() => setMatching(false))
  }, [raw, open, matched])

  const waFormat = raw.trim().length > 0 && isWhatsAppFormat(raw)
  const parsed: ParsedMessage[] = raw.trim().length === 0
    ? []
    : waFormat
      ? parseWhatsAppChat(raw)
      : parsePlainConversation(raw)
  const mapped = mapMessages(parsed, ownName)
  const outCount = mapped.filter((m) => m.direction === 'outbound').length
  const inCount  = mapped.length - outCount

  const filteredCustomers = (() => {
    if (!query.trim()) return customers.slice(0, 10)
    const q = query.toLowerCase()
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || (c.company ?? '').toLowerCase().includes(q))
      .slice(0, 10)
  })()

  function pickCustomer(c: CustomerOption) {
    setMatched({ customer_id: c.id, name: c.name, company: c.company })
    setManualSearch(false)
  }

  async function handleImport() {
    if (mapped.length === 0 || !matched) return
    setLoading(true)
    try {
      const res = await fetch('/api/interactions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: matched.customer_id,
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
      toast.success(`${data.count} mensagens importadas para ${matched.name}.`)
      onClose()
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao importar.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] flex flex-col"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--foreground)' }}>Colar conversa</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          <Textarea
            rows={10}
            placeholder="Cola aqui a conversa do WhatsApp ou texto. Vamos detectar o cliente pelo número de telefone."
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            className="font-mono text-xs resize-none"
            style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
          />

          {/* Match status row */}
          {raw.trim().length >= 20 && (
            <div
              className="rounded-lg p-3 flex items-center gap-3"
              style={{
                background: matched
                  ? 'rgba(45,185,117,0.08)'
                  : detectedPhone
                    ? 'rgba(245,158,11,0.08)'
                    : 'var(--muted)',
                border: `1px solid ${matched ? 'rgba(45,185,117,0.25)' : detectedPhone ? 'rgba(245,158,11,0.25)' : 'var(--border)'}`,
              }}
            >
              {matching ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--primary)' }} />
                  <span className="text-[12.5px]" style={{ color: 'var(--muted-foreground)' }}>
                    A procurar cliente para {detectedPhone ?? '…'}…
                  </span>
                </>
              ) : matched ? (
                <>
                  <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--status-active)' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] font-medium" style={{ color: 'var(--foreground)' }}>
                      {matched.name}
                      {matched.company && (
                        <span style={{ color: 'var(--muted-foreground)', fontWeight: 400 }}> · {matched.company}</span>
                      )}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
                      {detectedPhone ? `Detectado por telefone ${detectedPhone}` : 'Selecionado manualmente'}
                    </p>
                  </div>
                  <button
                    onClick={() => { setMatched(null); setManualSearch(true) }}
                    className="text-[11.5px] underline hover:opacity-70"
                    style={{ color: 'var(--muted-foreground)' }}
                  >
                    mudar
                  </button>
                </>
              ) : detectedPhone ? (
                <>
                  <Phone className="h-4 w-4" style={{ color: '#F59E0B' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] font-medium" style={{ color: 'var(--foreground)' }}>
                      Número {detectedPhone} não corresponde a nenhum cliente
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
                      Procura manualmente ou guarda este número no cliente certo primeiro.
                    </p>
                  </div>
                  <button
                    onClick={() => setManualSearch(true)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium"
                    style={{ background: 'var(--foreground)', color: 'var(--card)' }}
                  >
                    <UserSearch className="h-3 w-3" /> Procurar
                  </button>
                </>
              ) : (
                <>
                  <UserSearch className="h-4 w-4" style={{ color: 'var(--muted-foreground)' }} />
                  <span className="flex-1 text-[12.5px]" style={{ color: 'var(--muted-foreground)' }}>
                    Não detectei número de telefone. Escolhe o cliente manualmente.
                  </span>
                  <button
                    onClick={() => setManualSearch(true)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium"
                    style={{ background: 'var(--foreground)', color: 'var(--card)' }}
                  >
                    Procurar
                  </button>
                </>
              )}
            </div>
          )}

          {/* Manual search */}
          {manualSearch && !matched && (
            <div
              className="rounded-lg overflow-hidden"
              style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
                <Search className="h-3.5 w-3.5" style={{ color: 'var(--muted-foreground)' }} />
                <input
                  autoFocus
                  className="flex-1 bg-transparent text-sm outline-none"
                  style={{ color: 'var(--foreground)' }}
                  placeholder="Procurar cliente por nome ou empresa…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button
                  onClick={() => setManualSearch(false)}
                  className="opacity-50 hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" style={{ color: 'var(--muted-foreground)' }} />
                </button>
              </div>
              <div className="max-h-48 overflow-auto">
                {filteredCustomers.length === 0 ? (
                  <p className="px-3 py-2 text-[12px] text-center" style={{ color: 'var(--muted-foreground)' }}>
                    Sem resultados
                  </p>
                ) : (
                  filteredCustomers.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => pickCustomer(c)}
                      className="w-full flex flex-col items-start text-left px-3 py-2 row-hover"
                      style={{ borderBottom: '1px solid var(--border)' }}
                    >
                      <span className="text-[13px] font-medium" style={{ color: 'var(--foreground)' }}>{c.name}</span>
                      {c.company && (
                        <span className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>{c.company}</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Config row */}
          {matched && mapped.length > 0 && (
            <div className="flex gap-3 flex-wrap">
              <div className="flex-1 min-w-[140px] space-y-1.5">
                <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
                  O teu nome (separar vários por vírgula)
                </Label>
                <Input
                  value={ownName}
                  onChange={(e) => setOwnName(e.target.value)}
                  placeholder="Pedro, Kapta Media"
                  style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)', height: 36 }}
                />
              </div>
              <div className="flex-1 min-w-[140px] space-y-1.5">
                <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>Tipo</Label>
                <Select value={type} onValueChange={(v) => setType(v as InteractionType)}>
                  <SelectTrigger style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)', height: 36 }}>
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
          )}

          {/* Preview */}
          {matched && mapped.length > 0 && (
            <div className="space-y-2">
              <p className="text-[12px] font-medium" style={{ color: 'var(--foreground)' }}>
                {mapped.length} mensagens detetadas
                {mapped.length > 1 && ` (${inCount} recebidas, ${outCount} enviadas)`}
              </p>
              <div className="rounded-xl overflow-y-auto max-h-40 space-y-1.5 p-3" style={{ background: 'var(--muted)' }}>
                {mapped.slice(0, 30).map((m, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-[11.5px]">
                    <span
                      className="rounded-full px-1.5 py-0.5 shrink-0 font-medium"
                      style={{
                        background: m.direction === 'outbound' ? 'rgba(91,91,214,0.12)' : 'rgba(45,185,117,0.12)',
                        color: m.direction === 'outbound' ? 'var(--primary)' : '#2DB975',
                      }}
                    >
                      {m.direction === 'outbound' ? '↑' : '↓'}
                    </span>
                    <span className="truncate" style={{ color: 'var(--foreground)' }}>
                      <span className="font-medium">{m.sender}: </span>
                      {m.content.slice(0, 100)}{m.content.length > 100 ? '…' : ''}
                    </span>
                  </div>
                ))}
                {mapped.length > 30 && (
                  <p className="text-[11px] text-center pt-1" style={{ color: 'var(--muted-foreground)' }}>
                    + {mapped.length - 30} mensagens não mostradas
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button
            variant="outline"
            onClick={onClose}
            style={{ border: '1px solid var(--border)', color: 'var(--foreground)', background: 'transparent' }}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleImport}
            disabled={!matched || mapped.length === 0 || loading}
            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            {loading ? 'A importar…' : matched ? `Importar ${mapped.length} mensagens` : 'Escolhe cliente primeiro'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
