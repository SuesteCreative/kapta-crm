'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, Plug, CheckCircle2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDate } from '@/lib/utils'
import {
  FH_STATUS_LABELS,
  type FhIntegration, type FhIntegrationStatus, type FhCountry,
} from '@/lib/database.types'

type Row = FhIntegration & {
  customers: { id: string; name: string; company: string | null } | null
}

const STATUS_STYLES: Record<FhIntegrationStatus, { bg: string; text: string }> = {
  new:          { bg: 'rgba(91,91,214,0.1)',   text: 'var(--primary)' },
  onboarding:   { bg: 'rgba(245,158,11,0.1)',  text: '#B45309' },
  live:         { bg: 'rgba(45,185,117,0.12)', text: '#1a9e6c' },
  troubleshoot: { bg: 'rgba(229,72,77,0.1)',   text: '#C0272B' },
  follow_up:    { bg: 'rgba(59,130,246,0.1)',  text: '#1d4ed8' },
  churned:      { bg: 'rgba(156,163,175,0.1)', text: '#6B7280' },
}

const COUNTRY_LABELS: Record<FhCountry, string> = {
  PT: 'Portugal',
  ES: 'Espanha',
  other: 'Outro',
}

export function FhIntegrationsClient({ rows }: { rows: Row[] }) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | FhIntegrationStatus>('all')
  const [countryFilter, setCountryFilter] = useState<'all' | FhCountry>('all')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
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

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length }
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1
    return c
  }, [rows])

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" style={{ color: 'var(--foreground)' }}>
            <Plug className="h-6 w-6" style={{ color: 'var(--primary)' }} />
            Integrações FareHarbor
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted-foreground)' }}>
            {rows.length} {rows.length === 1 ? 'parceiro' : 'parceiros'} · PT + ES
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

      {/* List */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="rounded-xl p-10 text-center" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              {rows.length === 0
                ? 'Ainda sem integrações. Aparecerão aqui quando converter um pedido do email.'
                : 'Sem resultados para estes filtros.'}
            </p>
          </div>
        )}
        {filtered.map((r) => {
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
    </div>
  )
}
