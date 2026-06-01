'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Search, Plug, CheckCircle2, Inbox, AlertCircle,
  ChevronRight, Sparkles, Loader2, MailWarning, Mail, FileCheck2, RefreshCw,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { formatDate } from '@/lib/utils'
import {
  FH_STATUS_LABELS, FH_STATUS_ORDER,
  FH_COUNTRY_ORDER, FH_COUNTRY_LABELS, normalizeFhCountry,
  normalizeInvoicingSystem, FH_INVOICING_NONE_LABEL,
  type FhIntegration, type FhIntegrationStatus, type FhCountry,
} from '@/lib/database.types'
import type { FhIntegrationParsed } from '@/lib/fh-integration-parser'
import { FhIntegrationDialog } from '@/components/fh-integration-dialog'
import { convertPendingToIntegration, shortnameToCompanyGuess, findSameDomainIntegrations } from '@/lib/customer-resolver'

type Row = FhIntegration & {
  customers: { id: string; name: string; company: string | null } | null
}

export interface PendingFhEmail {
  /** Null when the pending row came only from the FH admin endpoint (no matching email yet). */
  interaction_id: string | null
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
  legacy?: boolean
  /** Stable id from the FH admin endpoint; null for email-only rows. */
  fh_admin_id?: number | null
  /** Endpoint `data_criacao` (when the form was submitted on the admin side). */
  submitted_at?: string | null
  /** Whether this row appears in the FH admin endpoint payload. */
  from_endpoint?: boolean
  /** Whether this row has a matching flagged IMAP interaction. */
  from_email?: boolean
}

const STATUS_STYLES: Record<FhIntegrationStatus, { bg: string; text: string }> = {
  new:              { bg: 'rgba(91,91,214,0.1)',   text: 'var(--primary)' },
  onboarding:       { bg: 'rgba(245,158,11,0.1)',  text: '#B45309' },
  api_received:     { bg: 'rgba(14,165,233,0.10)', text: '#0369a1' },
  integration_done: { bg: 'rgba(16,185,129,0.10)', text: '#047857' },
  live:             { bg: 'rgba(45,185,117,0.12)', text: '#1a9e6c' },
  troubleshoot:     { bg: 'rgba(229,72,77,0.1)',   text: '#C0272B' },
  follow_up:        { bg: 'rgba(59,130,246,0.1)',  text: '#1d4ed8' },
  personalizado:    { bg: 'rgba(168,85,247,0.10)', text: '#7c3aed' },
  lixo:             { bg: 'rgba(156,163,175,0.1)', text: '#6B7280' },
}

const PENDING_STYLE = { bg: 'rgba(229,72,77,0.10)', text: '#C0272B' }

// Source-of-origin badges for pending rows.
const SOURCE_STYLES = {
  both:     { bg: 'rgba(45,185,117,0.10)', text: '#1a9e6c', label: 'Form + Email' },
  endpoint: { bg: 'rgba(245,158,11,0.10)', text: '#B45309', label: 'Form (email atrasado)' },
  email:    { bg: 'rgba(229,72,77,0.10)',  text: '#C0272B', label: 'Email (não está no admin)' },
} as const

function sourceKey(p: PendingFhEmail): 'both' | 'endpoint' | 'email' {
  if (p.from_endpoint && p.from_email) return 'both'
  if (p.from_endpoint) return 'endpoint'
  return 'email'
}

// Stable id for state maps + React keys: endpoint id when available,
// otherwise the linked interaction id, otherwise an email+shortname fallback.
function pendingKey(p: PendingFhEmail): string {
  if (p.fh_admin_id != null) return `admin:${p.fh_admin_id}`
  if (p.interaction_id) return `int:${p.interaction_id}`
  return `fallback:${p.email ?? ''}:${p.shortname ?? ''}`
}

export function FhIntegrationsClient({
  rows, pending, endpointError,
}: {
  rows: Row[]
  pending: PendingFhEmail[]
  endpointError?: string | null
}) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [countryFilter, setCountryFilter] = useState<'all' | FhCountry>('all')
  const [invoicingFilter, setInvoicingFilter] = useState<string>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogCtx, setDialogCtx] = useState<{ sourceId: string | null; prefill: FhIntegrationParsed | null } | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [statusSaving, setStatusSaving] = useState<Record<string, boolean>>({})
  const [aiSuggesting, setAiSuggesting] = useState<Record<string, boolean>>({})
  const [converting, setConverting] = useState<Record<string, boolean>>({})
  const [syncing, setSyncing] = useState(false)

  const q = search.trim().toLowerCase()

  // Dynamic invoicing-system list, normalized + deduped across pending + active rows.
  // Any new system that lands in a request shows up here automatically. "None" pinned last.
  const invoicingOptions = useMemo(() => {
    const byKey = new Map<string, string>()
    const add = (raw: string | null | undefined) => {
      const n = normalizeInvoicingSystem(raw)
      byKey.set(n.toLowerCase(), n)
    }
    for (const p of pending) add(p.invoicing_system)
    for (const r of rows) add(r.invoicing_system)
    return [...byKey.values()].sort((a, b) => {
      if (a === FH_INVOICING_NONE_LABEL) return 1
      if (b === FH_INVOICING_NONE_LABEL) return -1
      return a.localeCompare(b)
    })
  }, [pending, rows])

  const filteredPending = useMemo(() => pending.filter((p) => {
    if (countryFilter !== 'all') {
      const c = normalizeFhCountry(p.country) ?? 'other'
      if (c !== countryFilter) return false
    }
    if (invoicingFilter !== 'all' && normalizeInvoicingSystem(p.invoicing_system) !== invoicingFilter) return false
    if (!q) return true
    return (
      (p.shortname?.toLowerCase().includes(q) ?? false) ||
      (p.name?.toLowerCase().includes(q) ?? false) ||
      (p.email?.toLowerCase().includes(q) ?? false) ||
      (p.invoicing_system?.toLowerCase().includes(q) ?? false) ||
      normalizeInvoicingSystem(p.invoicing_system).toLowerCase().includes(q) ||
      (p.subject?.toLowerCase().includes(q) ?? false)
    )
  }), [pending, countryFilter, invoicingFilter, q])

  const filteredIntegrations = useMemo(() => rows.filter((r) => {
    if (countryFilter !== 'all' && r.country !== countryFilter) return false
    if (invoicingFilter !== 'all' && normalizeInvoicingSystem(r.invoicing_system) !== invoicingFilter) return false
    if (!q) return true
    return (
      r.shortname.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q) ||
      (r.invoicing_system?.toLowerCase().includes(q) ?? false) ||
      normalizeInvoicingSystem(r.invoicing_system).toLowerCase().includes(q)
    )
  }), [rows, countryFilter, invoicingFilter, q])

  // Group integrations by status
  const byStatus = useMemo(() => {
    const m: Record<FhIntegrationStatus, Row[]> = {
      new: [], onboarding: [], api_received: [], integration_done: [],
      live: [], troubleshoot: [], follow_up: [], personalizado: [], lixo: [],
    }
    for (const r of filteredIntegrations) m[r.status].push(r)
    return m
  }, [filteredIntegrations])

  function toggleSection(key: string) {
    setCollapsed((c) => ({ ...c, [key]: !c[key] }))
  }

  function openPendingDialog(p: PendingFhEmail) {
    const prefill: FhIntegrationParsed = {
      name:            p.name ?? undefined,
      shortname:       p.shortname ?? undefined,
      email:           p.email ?? undefined,
      country:         normalizeFhCountry(p.country) ?? undefined,
      invoicingSystem: p.invoicing_system ?? undefined,
      authorization:   p.authorization ?? undefined,
    }
    setDialogCtx({ sourceId: p.interaction_id, prefill })
    setDialogOpen(true)
  }

  // Auto-create integration from a pending row + redirect to detail page.
  // If data is incomplete (no email or shortname), fall back to the dialog.
  async function convertPending(p: PendingFhEmail, status: FhIntegrationStatus = 'new') {
    if (!p.email || !p.shortname) {
      openPendingDialog(p)
      return
    }

    // Warn before creating a likely duplicate of an existing same-domain integration.
    const dupes = await findSameDomainIntegrations(p.email)
    if (dupes.length > 0) {
      const list = dupes.map((d) => `• ${d.name} (${d.shortname}) — ${FH_STATUS_LABELS[d.status]}`).join('\n')
      if (!confirm(`Já existe integração com o mesmo domínio:\n\n${list}\n\nÉ a mesma empresa? Se sim, cancela e usa "Unir duplicado". Criar mesmo assim?`)) {
        return
      }
    }

    const key = pendingKey(p)
    setConverting((s) => ({ ...s, [key]: true }))
    try {
      const country: FhCountry | null = normalizeFhCountry(p.country)

      const { fh_integration_id } = await convertPendingToIntegration({
        source_interaction_id: p.interaction_id,
        name: p.name ?? '',
        email: p.email,
        shortname: p.shortname,
        country,
        invoicing_system: p.invoicing_system,
        authorized: p.authorization ?? false,
        status,
        fallback_company_name: shortnameToCompanyGuess(p.shortname),
      })
      router.push(`/fareharbor/${fh_integration_id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao converter.')
      setConverting((s) => ({ ...s, [key]: false }))
    }
  }

  // Re-scan stored emails for the FH form template and flag any missed ones
  // (including ones forwarded by a team member, which the live classifier skips).
  async function syncEmails() {
    setSyncing(true)
    try {
      const res = await fetch('/api/fareharbor/sync-emails', { method: 'POST' })
      const json = await res.json().catch(() => ({} as Record<string, unknown>))
      if (!res.ok || !json.ok) throw new Error((json.error as string) ?? `HTTP ${res.status}`)
      const found = (json.flagged as number) ?? 0
      if (found > 0) {
        toast.success(`${found} novo${found === 1 ? '' : 's'} pedido${found === 1 ? '' : 's'} encontrado${found === 1 ? '' : 's'}`)
        router.refresh()
      } else {
        toast(`Sem novos pedidos · ${(json.scanned as number) ?? 0} emails verificados`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao sincronizar emails.')
    } finally {
      setSyncing(false)
    }
  }

  async function changeStatus(rowId: string, next: FhIntegrationStatus) {
    setStatusSaving((s) => ({ ...s, [rowId]: true }))
    try {
      const { error } = await supabase
        .from('fh_integrations')
        .update({ status: next })
        .eq('id', rowId)
      if (error) throw error
      toast.success(`Estado: ${FH_STATUS_LABELS[next]}`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao atualizar estado.')
    } finally {
      setStatusSaving((s) => ({ ...s, [rowId]: false }))
    }
  }

  async function suggestStatus(rowId: string) {
    setAiSuggesting((s) => ({ ...s, [rowId]: true }))
    try {
      const res = await fetch('/api/ai/fh-suggest-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fh_integration_id: rowId }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Erro IA')
      const next = json.suggested_status as FhIntegrationStatus
      const reason = json.reason as string
      const label = FH_STATUS_LABELS[next] ?? next

      toast(
        `Sugestão: ${label}`,
        {
          description: reason,
          duration: 12000,
          action: {
            label: 'Aplicar',
            onClick: () => changeStatus(rowId, next),
          },
        },
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro IA')
    } finally {
      setAiSuggesting((s) => ({ ...s, [rowId]: false }))
    }
  }

  const totalIntegrations = rows.length
  const totalPending      = pending.length

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" style={{ color: 'var(--foreground)' }}>
            <Plug className="h-6 w-6" style={{ color: 'var(--primary)' }} />
            Integrações FareHarbor
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted-foreground)' }}>
            {totalPending > 0 && (
              <>
                <span style={{ color: PENDING_STYLE.text, fontWeight: 600 }}>
                  {totalPending} por contactar
                </span>
                {' · '}
              </>
            )}
            {totalIntegrations} {totalIntegrations === 1 ? 'parceiro ativo' : 'parceiros ativos'}
          </p>
        </div>
        <Button
          onClick={syncEmails}
          disabled={syncing}
          variant="outline"
          size="sm"
          className="h-9 gap-2 rounded-lg text-sm shrink-0"
          title="Procurar pedidos de integração nos emails (inclui reencaminhados)"
        >
          {syncing
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <RefreshCw className="h-4 w-4" />}
          Sincronizar emails
        </Button>
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
            {FH_COUNTRY_ORDER.map((c) => (
              <SelectItem key={c} value={c}>{FH_COUNTRY_LABELS[c]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={invoicingFilter} onValueChange={setInvoicingFilter}>
          <SelectTrigger className="h-9 w-48 text-sm rounded-lg"><SelectValue placeholder="Faturação" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os sistemas</SelectItem>
            {invoicingOptions.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Endpoint failure banner — keeps page working if the admin pull errored. */}
      {endpointError && (
        <div
          className="rounded-xl p-3 text-[12.5px] flex items-start gap-2"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#B45309' }}
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Não foi possível ler o admin FareHarbor.</p>
            <p className="opacity-80">{endpointError} A lista abaixo mostra apenas os pedidos que chegaram por email.</p>
          </div>
        </div>
      )}

      {/* Pending — top, always-rendered accordion (if any) */}
      {filteredPending.length > 0 && (
        <AccordionSection
          icon={<Inbox className="h-4 w-4" style={{ color: PENDING_STYLE.text }} />}
          title="Por contactar"
          count={filteredPending.length}
          color={PENDING_STYLE.text}
          collapsed={collapsed['__pending'] ?? false}
          onToggle={() => toggleSection('__pending')}
        >
          {filteredPending.map((p) => {
            const key = pendingKey(p)
            const isConverting = converting[key]
            const src = sourceKey(p)
            const srcStyle = SOURCE_STYLES[src]
            const SrcIcon = src === 'both' ? FileCheck2 : src === 'endpoint' ? MailWarning : Mail
            return (
              <div
                key={key}
                className="rounded-xl p-5 transition-colors"
                style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)', border: `1px solid ${PENDING_STYLE.text}33` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    onClick={() => {
                      // No shortname → can't auto-create. Open dialog so Pedro fills the gap.
                      if (!p.shortname) openPendingDialog(p)
                      else convertPending(p, 'new')
                    }}
                    disabled={isConverting}
                    className="flex-1 min-w-0 space-y-1 text-left hover:opacity-90 disabled:opacity-60"
                    title={p.shortname
                      ? 'Abrir ficha (cria integração e abre detalhe)'
                      : 'Preencher shortname antes de criar integração'}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-[14px]" style={{ color: 'var(--foreground)' }}>
                        {p.name ?? '(sem nome)'}
                      </p>
                      {p.shortname ? (
                        <span
                          className="text-[11px] font-mono rounded px-1.5 py-px"
                          style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}
                        >
                          {p.shortname}
                        </span>
                      ) : (
                        <span
                          className="text-[10.5px] rounded px-1.5 py-px italic"
                          style={{ background: 'rgba(245,158,11,0.1)', color: '#B45309' }}
                          title="Falta shortname — clica para preencher"
                        >
                          sem shortname
                        </span>
                      )}
                    </div>
                    <p className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
                      {p.email ?? '—'}
                    </p>
                    {p.subject && (
                      <p className="text-[11.5px] truncate" style={{ color: 'var(--muted-foreground)' }}>
                        <span style={{ color: 'var(--muted-foreground)' }}>↳ </span>{p.subject}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 mt-1.5 text-[11.5px]" style={{ color: 'var(--muted-foreground)' }}>
                      <span
                        className="rounded-full px-2 py-0.5 inline-flex items-center gap-1 font-medium"
                        style={{ background: srcStyle.bg, color: srcStyle.text }}
                        title={
                          src === 'both'
                            ? 'Pedido presente no admin FareHarbor e com email recebido — match completo.'
                            : src === 'endpoint'
                              ? 'No admin FareHarbor mas sem email correspondente. Pode estar atrasado no IMAP ou perdido no spam.'
                              : 'Email recebido mas não encontrado no admin FareHarbor. Pode não ter sido submetido via formulário ou foi removido.'
                        }
                      >
                        <SrcIcon className="h-3 w-3" /> {srcStyle.label}
                      </span>
                      {p.country && (
                        <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--muted)' }}>
                          {(() => {
                            const c = normalizeFhCountry(p.country)
                            return c ? FH_COUNTRY_LABELS[c] : p.country
                          })()}
                        </span>
                      )}
                      <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--muted)' }}>
                        {normalizeInvoicingSystem(p.invoicing_system)}
                      </span>
                    </div>
                  </button>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <Select
                      value="__pending__"
                      onValueChange={(v) => {
                        if (v === '__pending__') return
                        // Without shortname we can't auto-create — funnel through dialog.
                        if (!p.shortname) { openPendingDialog(p); return }
                        convertPending(p, v as FhIntegrationStatus)
                      }}
                      disabled={isConverting}
                    >
                      <SelectTrigger
                        className="h-7 text-[11.5px] w-44 rounded-full border-0 font-medium px-3 inline-flex items-center gap-1"
                        style={{ background: PENDING_STYLE.bg, color: PENDING_STYLE.text }}
                      >
                        {isConverting
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <><AlertCircle className="h-3 w-3" /> Por contactar</>}
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__pending__" disabled>Por contactar</SelectItem>
                        {FH_STATUS_ORDER.map((s) => (
                          <SelectItem key={s} value={s}>→ {FH_STATUS_LABELS[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-[11px] tabular-nums" style={{ color: 'var(--muted-foreground)' }}>
                      {formatDate(p.occurred_at)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </AccordionSection>
      )}

      {/* Active integrations per status */}
      {FH_STATUS_ORDER.map((status) => {
        const list = byStatus[status]
        if (list.length === 0) return null
        const style = STATUS_STYLES[status]
        return (
          <AccordionSection
            key={status}
            icon={<Plug className="h-4 w-4" style={{ color: style.text }} />}
            title={FH_STATUS_LABELS[status]}
            count={list.length}
            color={style.text}
            collapsed={collapsed[status] ?? false}
            onToggle={() => toggleSection(status)}
          >
            {list.map((r) => {
              const ss = STATUS_STYLES[r.status]
              return (
                <div
                  key={r.id}
                  className="rounded-xl p-5 transition-colors"
                  style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/fareharbor/${r.id}`} className="flex-1 min-w-0 space-y-1 hover:opacity-90">
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
                            {FH_COUNTRY_LABELS[r.country] ?? r.country}
                          </span>
                        )}
                        <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--muted)' }}>
                          {normalizeInvoicingSystem(r.invoicing_system)}
                        </span>
                        {r.customers && (
                          <span className="rounded-full px-2 py-0.5" style={{ background: 'rgba(91,91,214,0.08)', color: 'var(--primary)' }}>
                            {r.customers.name}{r.customers.company ? ` · ${r.customers.company}` : ''}
                          </span>
                        )}
                      </div>
                    </Link>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <Select
                        value={r.status}
                        onValueChange={(v) => changeStatus(r.id, v as FhIntegrationStatus)}
                        disabled={statusSaving[r.id]}
                      >
                        <SelectTrigger
                          className="h-7 text-[11.5px] w-44 rounded-full border-0 font-medium px-3"
                          style={{ background: ss.bg, color: ss.text }}
                        >
                          {statusSaving[r.id]
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <SelectValue />}
                        </SelectTrigger>
                        <SelectContent>
                          {FH_STATUS_ORDER.map((s) => (
                            <SelectItem key={s} value={s}>{FH_STATUS_LABELS[s]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={() => suggestStatus(r.id)}
                          disabled={aiSuggesting[r.id]}
                          variant="outline"
                          size="sm"
                          className="h-6 text-[11px] gap-1 px-2"
                          title="Pedir à IA para sugerir o estado"
                        >
                          {aiSuggesting[r.id]
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Sparkles className="h-3 w-3" />}
                          IA
                        </Button>
                        <span className="text-[11px] tabular-nums" style={{ color: 'var(--muted-foreground)' }}>
                          {r.last_contact_at ? `Contacto: ${formatDate(r.last_contact_at)}` : formatDate(r.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </AccordionSection>
        )
      })}

      {filteredPending.length === 0 && filteredIntegrations.length === 0 && (
        <div className="rounded-xl p-10 text-center" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
          <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
            {totalIntegrations === 0 && totalPending === 0
              ? 'Ainda sem pedidos. Aparecerão aqui quando um email FH chegar.'
              : 'Sem resultados para estes filtros.'}
          </p>
        </div>
      )}

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

function AccordionSection({
  icon, title, count, color, collapsed, onToggle, children,
}: {
  icon: React.ReactNode
  title: string
  count: number
  color: string
  collapsed: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="space-y-3">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 px-1 w-full text-left hover:opacity-80 transition-opacity"
      >
        <ChevronRight
          className="h-4 w-4 transition-transform"
          style={{ color, transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}
        />
        {icon}
        <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color }}>
          {title} · {count}
        </p>
      </button>
      {!collapsed && <div className="space-y-3">{children}</div>}
    </div>
  )
}
