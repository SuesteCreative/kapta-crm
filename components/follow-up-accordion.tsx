'use client'

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  CalendarClock, Check, Clock, ChevronDown, ChevronUp, Mail, Phone, PenSquare, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import type { EmailContact } from '@/components/send-email-dialog'
import type { Interaction } from '@/lib/database.types'

const SendEmailDialog = dynamic(
  () => import('@/components/send-email-dialog').then((m) => ({ default: m.SendEmailDialog })),
  { ssr: false },
)

interface DueIdentifier { type: string; value: string; is_primary: boolean }
interface DueSource {
  type?: string
  direction?: string | null
  subject?: string | null
  content?: string | null
  occurred_at?: string
  metadata?: Record<string, unknown> | null
}
interface DueItem {
  id: string
  title: string
  description: string | null
  due_date: string
  priority: string
  overdue: boolean
  customer: { id: string; name: string; company: string | null; identifiers: DueIdentifier[] } | null
  source: DueSource | null
}

interface DraftCtx {
  followUpId: string
  customerId: string
  customerEmail: string
  customerName: string
  customerCompany: string | null
  interactions: Interaction[]
  allEmails: EmailContact[]
}

function formatDue(dateISO: string): string {
  return new Date(dateISO).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' })
}

export function FollowUpAccordion() {
  const [items, setItems] = useState<DueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [draftCtx, setDraftCtx] = useState<DraftCtx | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/follow-ups/due')
      const json = await res.json()
      if (json.ok) setItems(json.items ?? [])
    } catch {
      /* silent — a reminder list failing must not break the page */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function act(id: string, action: 'done' | 'snooze', days?: number) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/follow-ups/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, days }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Erro')
      setItems((prev) => prev.filter((i) => i.id !== id))
      toast.success(action === 'done' ? 'Follow-up concluído.' : 'Adiado 7 dias.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro na ação.')
    } finally {
      setBusyId(null)
    }
  }

  function openDraft(item: DueItem) {
    const c = item.customer
    if (!c) { toast.error('Follow-up sem cliente associado.'); return }
    const emails = c.identifiers.filter((i) => i.type === 'email')
    const primaryEmail = emails.find((e) => e.is_primary)?.value ?? emails[0]?.value ?? ''
    const allEmails: EmailContact[] = emails.map((e) => ({ label: c.name, email: e.value }))

    const interactions: Interaction[] = item.source
      ? [{
          id: `src-${item.id}`,
          customer_id: c.id,
          type: (item.source.type as Interaction['type']) ?? 'email',
          direction: (item.source.direction as Interaction['direction']) ?? 'outbound',
          subject: item.source.subject ?? null,
          content: item.source.content ?? null,
          source_id: null,
          bubbles_url: null,
          bubbles_title: null,
          metadata: item.source.metadata ?? null,
          is_read: true,
          occurred_at: item.source.occurred_at ?? new Date().toISOString(),
          created_at: item.source.occurred_at ?? new Date().toISOString(),
        }]
      : []

    setDraftCtx({
      followUpId: item.id,
      customerId: c.id,
      customerEmail: primaryEmail,
      customerName: c.name,
      customerCompany: c.company,
      interactions,
      allEmails,
    })
  }

  if (loading || items.length === 0) return null

  const overdue = items.filter((i) => i.overdue)
  const todayItems = items.filter((i) => !i.overdue)

  return (
    <>
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: 'rgba(91,91,214,0.05)', border: '1px solid rgba(91,91,214,0.22)' }}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3"
        >
          <div className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: 'var(--primary)' }}>
            <CalendarClock className="h-4 w-4" />
            {items.length} {items.length === 1 ? 'follow-up para contactar' : 'follow-ups para contactar'}
            {overdue.length > 0 && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                style={{ background: 'rgba(239,68,68,0.14)', color: 'rgb(220,38,38)' }}
              >
                {overdue.length} atrasado{overdue.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {expanded ? <ChevronUp className="h-4 w-4" style={{ color: 'var(--muted-foreground)' }} />
                    : <ChevronDown className="h-4 w-4" style={{ color: 'var(--muted-foreground)' }} />}
        </button>

        {expanded && (
          <div className="px-2 pb-2 space-y-1">
            {[...overdue, ...todayItems].map((item) => (
              <FollowUpRow
                key={item.id}
                item={item}
                busy={busyId === item.id}
                onDraft={() => openDraft(item)}
                onDone={() => act(item.id, 'done')}
                onSnooze={() => act(item.id, 'snooze', 7)}
              />
            ))}
          </div>
        )}
      </div>

      {draftCtx && (
        <SendEmailDialog
          open={!!draftCtx}
          customerId={draftCtx.customerId}
          customerEmail={draftCtx.customerEmail}
          customerName={draftCtx.customerName}
          customerCompany={draftCtx.customerCompany}
          interactions={draftCtx.interactions}
          allEmails={draftCtx.allEmails}
          initialSubject={draftCtx.interactions[0]?.subject ? `Re: ${draftCtx.interactions[0].subject}` : ''}
          onSent={() => {
            // Contacting the client resolves the follow-up.
            act(draftCtx.followUpId, 'done')
          }}
          onClose={() => setDraftCtx(null)}
        />
      )}
    </>
  )
}

function FollowUpRow({
  item, busy, onDraft, onDone, onSnooze,
}: {
  item: DueItem
  busy: boolean
  onDraft: () => void
  onDone: () => void
  onSnooze: () => void
}) {
  const c = item.customer
  const emails = c?.identifiers.filter((i) => i.type === 'email') ?? []
  const phones = c?.identifiers.filter((i) => i.type === 'phone' || i.type === 'whatsapp') ?? []

  return (
    <div
      className="rounded-lg px-3 py-2.5"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0 inline-flex items-center gap-1"
              style={{
                background: item.overdue ? 'rgba(239,68,68,0.12)' : 'rgba(91,91,214,0.12)',
                color: item.overdue ? 'rgb(220,38,38)' : 'var(--primary)',
              }}
            >
              <Clock className="h-2.5 w-2.5" />
              {item.overdue ? `Atrasado · ${formatDue(item.due_date)}` : 'Para hoje'}
            </span>
            <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--foreground)' }}>
              {c?.name ?? 'Cliente'}
              {c?.company && <span style={{ color: 'var(--muted-foreground)', fontWeight: 400 }}> · {c.company}</span>}
            </span>
          </div>

          <div className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--foreground)' }}>{item.title}</div>

          {(emails.length > 0 || phones.length > 0) && (
            <div className="flex flex-wrap gap-2 mt-1.5">
              {emails.slice(0, 2).map((e) => (
                <span key={e.value} className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
                  <Mail className="h-2.5 w-2.5" /> {e.value}
                </span>
              ))}
              {phones.slice(0, 1).map((p) => (
                <span key={p.value} className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
                  <Phone className="h-2.5 w-2.5" /> {p.value}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onDraft}
            disabled={busy}
            title="Abrir rascunho de email"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ background: 'rgba(91,91,214,0.1)', color: 'var(--primary)', border: '1px solid rgba(91,91,214,0.25)' }}
          >
            <PenSquare className="h-3 w-3" /> Rascunho
          </button>
          <button
            onClick={onSnooze}
            disabled={busy}
            title="Adiar 7 dias"
            className="rounded-md p-1.5 transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ border: '1px solid var(--border)', color: 'var(--muted-foreground)' }}
          >
            <Clock className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDone}
            disabled={busy}
            title="Concluir"
            className="rounded-md p-1.5 transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ border: '1px solid var(--border)', color: 'rgb(22,163,74)' }}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  )
}
