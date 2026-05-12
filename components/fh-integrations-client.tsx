'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, Plug, CheckCircle2, Inbox, AlertCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDate } from '@/lib/utils'
import {
  FH_STATUS_LABELS,
  type FhIntegration, type FhIntegrationStatus, type FhCountry,
} from '@/lib/database.types'
import type { FhIntegrationParsed } from '@/lib/fh-integration-parser'
import { FhIntegrationDialog } from '@/components/fh-integration-dialog'

type Row = FhIntegration & {
  customers: { id: string; name: string; company: string | null } | null
}

export interface PendingFhEmail {
  interaction_id: string
  occurred_at: string
  subject: string | null
  name: string | null
  email: string | null
  country: string | null
  invoicing_system: string | null
  shortname: string | null
  authorization: boolean | null
  parsed: Record<string, unknown>
  forwarded_to_customer: { id: string; name: string; company: string | null } | null
}

const STATUS_STYLES: Record<FhIntegrationStatus, { bg: string; text: string }> = {
  new:          { bg: 'rgba(91,91,214,0.1)',   text: 'var(--primary)' },
  onboarding:   { bg: 'rgba(245,158,11,0.1)',  text: '#B45309' },
  live:         { bg: 'rgba(45,185,117,0.12)', text: '#1a9e6c' },
  troubleshoot: { bg: 'rgba(229,72,77,0.1)',   text: '#C0272B' },
  follow_up:    { bg: 'rgba(59,130,246,0.1)',  text: '#1d4ed8' },
  churned:      { bg: 'rgba(156,163,175,0.1)', text: '#6B7280' },
}

const PENDING_STYLE = { bg: 'rgba(229,72,77,0.10)', text: '#C0272B' }

const COUNTRY_LABELS: Record<FhCountry, string> = {
  PT: 'Portugal',
  ES: 'Espanha',
  other: 'Outro',
}

type StatusFilter = 'all' | 'pending' | FhIntegrationStatus

export function FhIntegrationsClient({ rows, pending }: { rows: Row[]; pending: PendingFhEmail[] }) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [countryFilter, setCountryFilter] = useState<'all' | FhCountry>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogCtx, setDialogCtx] = useState<{ sourceId: string; prefill: FhIntegrationParsed | null } | null>(null)

  const filteredIntegrations = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (statusFilter === 'pending') return false
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (countryFilter !== 'all' && r.country !== countryFilter) return false
      if (!q) return true
      return (
        r.shortname.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.invoicing_system?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [rows, search, statusFilter, countryFilter])

  const filteredPending = useMemo(() => {
    const q = search.trim().toLowerCase()
    return pending.filter((p) => {
      if (statusFilter !== 'all' && statusFilter !== 'pending') return false
      if (countryFilter !== 'all') {
        const c = (p.country ?? '').toUpperCase()
        if (countryFilter === 'PT' && c !== 'PT') return false
        if (countryFilter === 'ES' && c !== 'ES') return false
        if (countryFilter === 'other' && (c === 'PT' || c === 'ES')) return false
      }
      if (!q) return true
      return (
        (p.shortname?.toLowerCase().includes(q) ?? false) ||
        (p.name?.toLowerCase().includes(q) ?? false) ||
        (p.email?.toLowerCase().includes(q) ?? false) ||
        (p.invoicing_system?.toLowerCase().includes(q) ?? false) ||
        (p.subject?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [pending, search, statusFilter, countryFilter])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length + pending.length, pending: pending.length }
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1
    return c
  }, [rows, pending])

  function openPendingDialog(p: PendingFhEmail) {
    const prefill: FhIntegrationParsed = {
      name:            p.name ?? undefined,
      shortname:       p.shortname ?? undefined,
      email:           p.email ?? undefined,
      country:         (p.country?.toUpperCase() === 'PT' ? 'PT' :
                        p.country?.toUpperCase() === 'ES' ? 'ES' :
                        p.country ? 'other' : undefined),
      invoicingSystem: p.invoicing_system ?? undefined,
      authorization:   p.authorization ?? undefined,
    }
    setDialogCtx({ sourceId: p.interaction_id, prefill })
    setDialogOpen(true)
  }

  const hasPending = pending.length > 0

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" style={{ color: 'var(--foreground)' }}>
            <Plug className="h-6 w-6" style={{ color: 'var(--primary)' }} />
            Integrações FareHarbor
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted-foreground)' }}>
            {pending.length > 0 && (
              <>
                <span style={{ color: PENDING_STYLE.text, fontWeight: 600 }}>
                  {pending.length} por contactar
                </span>
                {' · '}
              </>
            )}
            {rows.length} {rows.length === 1 ? 'parceiro ativo' : 'parceiros ativos'} · PT + ES
          </p>
        </div>
      </div>

      {/* Status pill bar */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setStatusFilter('all')}
          className="rounded-full px-3 py-1 text-[12px] font-medium transition-opacity hover:opacity-80"
          style={{
            background: statusFilter === 'all' ? 'var(--foreground)' : 'var(--card)',
            color: statusFilter === 'all' ? 'var(--card)' : 'var(--foreground)',
            border: '1px solid var(--border)',
          }}
        >
          Todos · {counts.all ?? 0}
        </button>
        {hasPending && (
          <button
            onClick={() => setStatusFilter('pending')}
            className="rounded-full px-3 py-1 text-[12px] font-medium transition-opacity hover:opacity-80 inline-flex items-center gap-1"
            style={{
              background: statusFilter === 'pending' ? PENDING_STYLE.bg : 'var(--card)',
              color:      statusFilter === 'pending' ? PENDING_STYLE.text : 'var(--muted-foreground)',
              border: `1px solid ${statusFilter === 'pending' ? PENDING_STYLE.text : 'var(--border)'}`,
            }}
          >
            <AlertCircle className="h-3 w-3" />
            Por contactar · {counts.pending}
          </button>
        )}
        {(Object.keys(FH_STATUS_LABELS) as FhIntegrationStatus[]).map((s) => {
          const active = statusFilter === s
          const style = STATUS_STYLES[s]
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className="rounded-full px-3 py-1 text-[12px] font-medium transition-opacity hover:opacity-80"
              style={{
                background: active ? style.bg : 'var(--card)',
                color: active ? style.text : 'var(--muted-foreground)',
                border: `1px solid ${active ? style.text : 'var(--border)'}`,
              }}
            >
              {FH_STATUS_LABELS[s]} · {counts[s] ?? 0}
            </button>
          )
        })}
      </div>

      {/* Filters */}
      <div className="flex gap-2.5 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: 'var(--muted-foreground)' }} />
          <Input
            className="pl-9 h-9 w-[280px] text-sm rounded-lg"
            placeholder="Shortname, nome, email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={countryFilter} onValueChange={(v) => setCountryFilter(v as 'all' | FhCountry)}>
          <SelectTrigger className="h-9 w-40 text-sm rounded-lg"><SelectValue placeholder="País" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os países</SelectItem>
            <SelectItem value="PT">Portugal</SelectItem>
            <SelectItem value="ES">Espanha</SelectItem>
            <SelectItem value="other">Outro</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Pending list — top, visually distinct */}
      {filteredPending.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <Inbox className="h-4 w-4" style={{ color: PENDING_STYLE.text }} />
            <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: PENDING_STYLE.text }}>
              Por contactar · {filteredPending.length}
            </p>
          </div>
          {filteredPending.map((p) => (
            <button
              key={p.interaction_id}
              onClick={() => openPendingDialog(p)}
              className="block w-full text-left rounded-xl p-5 transition-colors hover:opacity-95"
              style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)', border: `1px solid ${PENDING_STYLE.text}33` }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-[14px]" style={{ color: 'var(--foreground)' }}>
                      {p.name ?? '(sem nome)'}
                    </p>
                    {p.shortname && (
                      <span
                        className="text-[11px] font-mono rounded px-1.5 py-px"
                        style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}
                      >
                        {p.shortname}
                      </span>
                    )}
                  </div>
                  <p className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
                    {p.email ?? '—'}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-1.5 text-[11.5px]" style={{ color: 'var(--muted-foreground)' }}>
                    {p.country && (
                      <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--muted)' }}>
                        {p.country.toUpperCase() === 'PT' ? 'Portugal'
                          : p.country.toUpperCase() === 'ES' ? 'Espanha'
                          : p.country}
                      </span>
                    )}
                    {p.invoicing_system && (
                      <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--muted)' }}>
                        {p.invoicing_system}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span
                    className="inline-flex items-center gap-1 text-[11.5px] font-medium rounded-full px-2.5 py-0.5"
                    style={{ background: PENDING_STYLE.bg, color: PENDING_STYLE.text }}
                  >
                    <AlertCircle className="h-3 w-3" />
                    Por contactar
                  </span>
                  <span className="text-[11px] tabular-nums" style={{ color: 'var(--muted-foreground)' }}>
                    {formatDate(p.occurred_at)}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Active integrations list */}
      <div className="space-y-3">
        {filteredIntegrations.length > 0 && (
          <div className="flex items-center gap-2 px-1 pt-2">
            <Plug className="h-4 w-4" style={{ color: 'var(--muted-foreground)' }} />
            <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted-foreground)' }}>
              Integrações · {filteredIntegrations.length}
            </p>
          </div>
        )}
        {filteredIntegrations.length === 0 && filteredPending.length === 0 && (
          <div className="rounded-xl p-10 text-center" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              {rows.length === 0 && pending.length === 0
                ? 'Ainda sem pedidos. Aparecerão aqui quando um email FH chegar.'
                : 'Sem resultados para estes filtros.'}
            </p>
          </div>
        )}
        {filteredIntegrations.map((r) => {
          const ss = STATUS_STYLES[r.status]
          return (
            <Link
              key={r.id}
              href={`/fareharbor/${r.id}`}
              className="block rounded-xl p-5 transition-colors hover:opacity-95"
              style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-[14px]" style={{ color: 'var(--foreground)' }}>
                      {r.name}
                    </p>
                    <span
                      className="text-[11px] font-mono rounded px-1.5 py-px"
                      style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}
                    >
                      {r.shortname}
                    </span>
                    {r.authorized && (
                      <CheckCircle2 className="h-3.5 w-3.5" style={{ color: 'var(--status-active)' }} />
                    )}
                  </div>
                  <p className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
                    {r.email}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-1.5 text-[11.5px]" style={{ color: 'var(--muted-foreground)' }}>
                    {r.country && (
                      <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--muted)' }}>
                        {COUNTRY_LABELS[r.country]}
                      </span>
                    )}
                    {r.invoicing_system && (
                      <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--muted)' }}>
                        {r.invoicing_system}
                      </span>
                    )}
                    {r.customers && (
                      <span className="rounded-full px-2 py-0.5" style={{ background: 'rgba(91,91,214,0.08)', color: 'var(--primary)' }}>
                        {r.customers.name}{r.customers.company ? ` · ${r.customers.company}` : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span
                    className="text-[11.5px] font-medium rounded-full px-2.5 py-0.5"
                    style={{ background: ss.bg, color: ss.text }}
                  >
                    {FH_STATUS_LABELS[r.status]}
                  </span>
                  <span className="text-[11px] tabular-nums" style={{ color: 'var(--muted-foreground)' }}>
                    {r.last_contact_at ? `Contacto: ${formatDate(r.last_contact_at)}` : formatDate(r.created_at)}
                  </span>
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {dialogCtx && (
        <FhIntegrationDialog
          open={dialogOpen}
          sourceInteractionId={dialogCtx.sourceId}
          prefill={dialogCtx.prefill}
          onClose={() => { setDialogOpen(false); router.refresh() }}
        />
      )}
    </div>
  )
}
