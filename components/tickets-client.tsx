'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Copy, Check } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PRIORITY_STYLES, formatDate } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { Ticket } from '@/lib/database.types'

type TicketWithCustomer = Ticket & { customers: { id: string; name: string; company: string | null } | null }

const TICKET_STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  open:          { bg: 'rgba(229,72,77,0.1)',   text: '#C0272B' },
  'in-progress': { bg: 'rgba(245,158,11,0.1)',  text: '#B45309' },
  resolved:      { bg: 'rgba(45,185,117,0.1)',  text: '#1a9e6c' },
  closed:        { bg: 'rgba(156,163,175,0.1)', text: '#6B7280' },
}


function ticketToText(t: TicketWithCustomer): string {
  return `# 🎫 ${t.title}

**Cliente:** ${t.customers?.name ?? 'N/A'}${t.customers?.company ? ` (${t.customers.company})` : ''}
**Prioridade:** ${t.priority.toUpperCase()}
**Estado:** ${t.status}

---

## Descrição
${t.description ?? '—'}

## Passos para reproduzir
${t.steps_to_reproduce ?? '—'}

## Comportamento esperado
${t.expected_behavior ?? '—'}

## Comportamento atual
${t.actual_behavior ?? '—'}

${t.tags.length ? `## Tags\n${t.tags.map((tag) => `\`${tag}\``).join(' ')}` : ''}

---
*${formatDate(t.created_at)} — Kapta CRM*`
}

export function TicketsClient({ tickets }: { tickets: TicketWithCustomer[] }) {
  const router = useRouter()
  const [statusFilter,   setStatusFilter]   = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [copiedId,       setCopiedId]       = useState<string | null>(null)

  const filtered = tickets.filter((t) => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false
    if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false
    return true
  })

  async function updateStatus(id: string, status: string) {
    await supabase.from('tickets').update({ status }).eq('id', id)
    router.refresh()
  }

  async function copyTicket(t: TicketWithCustomer) {
    await navigator.clipboard.writeText(ticketToText(t))
    setCopiedId(t.id)
    setTimeout(() => setCopiedId(null), 2000)
    toast.success('Ticket copiado!')
  }

  return (
    <div className="p-7 max-w-[900px] mx-auto space-y-6 animate-fade-in">

      {/* Header */}
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--foreground)' }}>
          Tickets
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
          {tickets.filter((t) => t.status === 'open').length} abertos · {tickets.length} total
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-2.5">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger
            className="h-9 w-40 text-sm rounded-lg"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
          >
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os estados</SelectItem>
            <SelectItem value="open">Aberto</SelectItem>
            <SelectItem value="in-progress">Em progresso</SelectItem>
            <SelectItem value="resolved">Resolvido</SelectItem>
            <SelectItem value="closed">Fechado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger
            className="h-9 w-40 text-sm rounded-lg"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
          >
            <SelectValue placeholder="Prioridade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="urgent">Urgente</SelectItem>
            <SelectItem value="high">Alta</SelectItem>
            <SelectItem value="medium">Média</SelectItem>
            <SelectItem value="low">Baixa</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Ticket list */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="rounded-xl p-10 text-center" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Sem tickets.</p>
          </div>
        )}
        {filtered.map((t) => {
          const ps = PRIORITY_STYLES[t.priority]
          const ss = TICKET_STATUS_STYLES[t.status]
          return (
            <div
              key={t.id}
              className="rounded-xl p-5 space-y-3"
              style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}
            >
              {/* Top row */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="font-semibold text-[14px]" style={{ color: 'var(--foreground)' }}>
                    {t.title}
                  </p>
                  {t.customers && (
                    <Link
                      href={`/customers/${t.customers.id}`}
                      className="text-[12px] transition-colors hover:opacity-70"
                      style={{ color: 'var(--primary)' }}
                    >
                      {t.customers.name}{t.customers.company ? ` · ${t.customers.company}` : ''}
                    </Link>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className="text-[11.5px] font-medium rounded-full px-2.5 py-0.5"
                    style={{ background: ps.bg, color: ps.text }}
                  >
                    {t.priority}
                  </span>

                  {/* Inline status selector */}
                  <Select value={t.status} onValueChange={(v) => updateStatus(t.id, v)}>
                    <SelectTrigger
                      className="h-7 text-[11.5px] w-36 rounded-full border-0 font-medium px-3"
                      style={{ background: ss.bg, color: ss.text }}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Aberto</SelectItem>
                      <SelectItem value="in-progress">Em progresso</SelectItem>
                      <SelectItem value="resolved">Resolvido</SelectItem>
                      <SelectItem value="closed">Fechado</SelectItem>
                    </SelectContent>
                  </Select>

                  <button
                    onClick={() => copyTicket(t)}
                    className="h-7 w-7 flex items-center justify-center rounded-lg transition-colors"
                    style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}
                    title="Copiar ticket"
                  >
                    {copiedId === t.id
                      ? <Check className="h-3.5 w-3.5" style={{ color: '#2DB975' }} />
                      : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {t.description && (
                <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{t.description}</p>
              )}

              {(t.steps_to_reproduce || t.actual_behavior) && (
                <div className="grid grid-cols-2 gap-3">
                  {t.steps_to_reproduce && (
                    <div
                      className="rounded-lg p-3 text-xs space-y-1"
                      style={{ background: 'var(--muted)' }}
                    >
                      <p className="font-semibold uppercase tracking-wide text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
                        Passos
                      </p>
                      <p className="whitespace-pre-wrap" style={{ color: 'var(--foreground)' }}>
                        {t.steps_to_reproduce}
                      </p>
                    </div>
                  )}
                  {t.actual_behavior && (
                    <div
                      className="rounded-lg p-3 text-xs space-y-1"
                      style={{ background: 'var(--muted)' }}
                    >
                      <p className="font-semibold uppercase tracking-wide text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
                        Comportamento atual
                      </p>
                      <p className="whitespace-pre-wrap" style={{ color: 'var(--foreground)' }}>
                        {t.actual_behavior}
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between">
                {t.tags.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {t.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md px-2 py-0.5 text-[11px] font-medium"
                        style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-[11px] ml-auto" style={{ color: 'var(--muted-foreground)' }}>
                  {formatDate(t.created_at)}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
