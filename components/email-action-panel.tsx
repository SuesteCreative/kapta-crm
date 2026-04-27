'use client'

import { useEffect, useRef, useState } from 'react'
import { Sparkles, Loader2, CheckCircle2, CalendarCheck, Ticket as TicketIcon, StickyNote, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { createFollowUp, createTicket, createNote, type Priority } from '@/lib/quick-create'

interface FollowUpSuggestion {
  kind: 'follow_up'
  title: string
  description?: string
  priority?: Priority
  due_offset_days?: number
}

interface TicketSuggestion {
  kind: 'ticket'
  title: string
  actual_behavior?: string
  priority?: Priority
}

interface NoteSuggestion {
  kind: 'note'
  title: string
  body?: string
}

type Suggestion = FollowUpSuggestion | TicketSuggestion | NoteSuggestion

interface Props {
  interactionId: string
  customerId: string
  customerName: string
  customerCompany: string | null
  email: {
    direction: 'inbound' | 'outbound' | null
    subject: string | null
    content: string | null
    occurred_at: string
  }
}

const cache = new Map<string, Suggestion[]>()

function offsetDateIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + Math.max(0, Math.floor(days)))
  return d.toISOString().slice(0, 10)
}

function priorityColor(p: Priority | undefined): string {
  switch (p) {
    case 'urgent': return 'rgba(239,68,68,0.14)'
    case 'high':   return 'rgba(245,158,11,0.14)'
    case 'medium': return 'rgba(91,91,214,0.12)'
    default:       return 'rgba(107,114,128,0.12)'
  }
}

function priorityLabel(p: Priority | undefined): string {
  return ({ urgent: 'urgente', high: 'alta', medium: 'média', low: 'baixa' } as const)[p ?? 'medium']
}

export function EmailActionPanel({
  interactionId,
  customerId,
  customerName,
  customerCompany,
  email,
}: Props) {
  const [loading, setLoading]         = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [created, setCreated]         = useState<Set<number>>(new Set())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setError(null)
    setCreated(new Set())

    const cached = cache.get(interactionId)
    if (cached) {
      setSuggestions(cached)
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchSuggestions()
    }, 500)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactionId])

  async function fetchSuggestions() {
    setLoading(true)
    setSuggestions(null)
    try {
      const [{ data: openFollowUps }, { data: openTickets }] = await Promise.all([
        supabase
          .from('follow_ups')
          .select('title')
          .eq('customer_id', customerId)
          .eq('status', 'open')
          .limit(10),
        supabase
          .from('tickets')
          .select('title')
          .eq('customer_id', customerId)
          .in('status', ['open', 'in-progress'])
          .limit(10),
      ])

      const res = await fetch('/api/ai/suggest-actions-from-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: customerName,
          customer_company: customerCompany,
          email,
          open_follow_ups: (openFollowUps ?? []).map((r) => r.title as string),
          open_tickets:    (openTickets ?? []).map((r) => r.title as string),
        }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Erro')
      const list = (json.suggestions ?? []) as Suggestion[]
      cache.set(interactionId, list)
      setSuggestions(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar sugestões.')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(idx: number, s: Suggestion) {
    try {
      if (s.kind === 'follow_up') {
        await createFollowUp({
          customer_id: customerId,
          title: s.title,
          description: s.description ?? null,
          due_date: typeof s.due_offset_days === 'number' ? offsetDateIso(s.due_offset_days) : null,
          priority: s.priority ?? 'medium',
        })
        toast.success('Follow-up criado')
      } else if (s.kind === 'ticket') {
        await createTicket({
          customer_id: customerId,
          title: s.title,
          actual_behavior: s.actual_behavior ?? null,
          priority: s.priority ?? 'medium',
        })
        toast.success('Ticket criado')
      } else {
        await createNote({
          customer_id: customerId,
          title: s.title,
          body: s.body ?? null,
        })
        toast.success('Nota guardada')
      }
      setCreated((prev) => new Set([...prev, idx]))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao criar.')
    }
  }

  if (loading) {
    return (
      <div className="px-5 py-4 text-[12px] flex items-center gap-2" style={{ color: 'var(--muted-foreground)' }}>
        <Loader2 className="h-3 w-3 animate-spin" />
        A analisar email…
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-5 py-3 text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
        {error}{' '}
        <button onClick={fetchSuggestions} className="underline hover:opacity-70">tentar de novo</button>
      </div>
    )
  }

  if (!suggestions || suggestions.length === 0) return null

  return (
    <div
      className="px-5 py-3 shrink-0"
      style={{ borderBottom: '1px solid var(--border)', background: 'rgba(91,91,214,0.04)' }}
    >
      <div className="flex items-center gap-1.5 mb-2 text-[11px] uppercase tracking-wide" style={{ color: 'var(--primary)' }}>
        <Sparkles className="h-3 w-3" />
        Ações sugeridas
      </div>
      <div className="space-y-2">
        {suggestions.map((s, idx) => {
          const isCreated = created.has(idx)
          const Icon =
            s.kind === 'follow_up' ? CalendarCheck :
            s.kind === 'ticket'    ? TicketIcon    :
                                      StickyNote
          const kindLabel =
            s.kind === 'follow_up' ? 'Follow-up' :
            s.kind === 'ticket'    ? 'Ticket'    :
                                      'Nota'

          return (
            <div
              key={idx}
              className="rounded-lg p-2.5 flex items-start gap-2.5"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
            >
              <div
                className="mt-0.5 w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                style={{ background: 'rgba(91,91,214,0.1)' }}
              >
                <Icon className="h-3 w-3" style={{ color: 'var(--primary)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                  <span className="text-[10.5px] uppercase tracking-wide" style={{ color: 'var(--muted-foreground)' }}>
                    {kindLabel}
                  </span>
                  {(s.kind === 'follow_up' || s.kind === 'ticket') && s.priority && (
                    <span
                      className="rounded-full px-1.5 py-0 text-[10px] font-medium"
                      style={{ background: priorityColor(s.priority), color: 'var(--foreground)' }}
                    >
                      {priorityLabel(s.priority)}
                    </span>
                  )}
                  {s.kind === 'follow_up' && typeof s.due_offset_days === 'number' && (
                    <span className="text-[10.5px]" style={{ color: 'var(--muted-foreground)' }}>
                      · {s.due_offset_days === 0 ? 'hoje' : s.due_offset_days === 1 ? 'amanhã' : `+${s.due_offset_days}d`}
                    </span>
                  )}
                </div>
                <p className="text-[12.5px] font-medium leading-snug" style={{ color: 'var(--foreground)' }}>
                  {s.title}
                </p>
                {s.kind === 'follow_up' && s.description && (
                  <p className="text-[11.5px] mt-0.5 leading-snug" style={{ color: 'var(--muted-foreground)' }}>
                    {s.description}
                  </p>
                )}
                {s.kind === 'ticket' && s.actual_behavior && (
                  <p className="text-[11.5px] mt-0.5 leading-snug" style={{ color: 'var(--muted-foreground)' }}>
                    {s.actual_behavior}
                  </p>
                )}
                {s.kind === 'note' && s.body && (
                  <p className="text-[11.5px] mt-0.5 leading-snug" style={{ color: 'var(--muted-foreground)' }}>
                    {s.body}
                  </p>
                )}
              </div>
              <button
                onClick={() => handleCreate(idx, s)}
                disabled={isCreated}
                className="shrink-0 self-start flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium transition-opacity hover:opacity-70 disabled:opacity-50"
                style={{
                  background: isCreated ? 'rgba(45,185,117,0.12)' : 'var(--foreground)',
                  color: isCreated ? 'var(--status-active)' : 'var(--card)',
                }}
              >
                {isCreated ? <><CheckCircle2 className="h-3 w-3" /> Criado</> : <><Plus className="h-3 w-3" /> Criar</>}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
