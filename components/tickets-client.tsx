'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Copy, Check, Sparkles, Loader2, Users, Mail } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { PRIORITY_STYLES, formatDate } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { BulkEmailDialog } from '@/components/bulk-email-dialog'
import type { Ticket } from '@/lib/database.types'

type TicketWithCustomer = Ticket & { customers: { id: string; name: string; company: string | null } | null }

type IssueCluster = {
  issue_title: string
  issue_description: string
  customer_ids: string[]
  customers: Array<{ id: string; name: string; company: string | null }>
  example_summary: string
}

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
  const [clustering,               setClustering]               = useState(false)
  const [clusters,                 setClusters]                 = useState<IssueCluster[]>([])
  const [bulkEmailCluster,         setBulkEmailCluster]         = useState<IssueCluster | null>(null)
  const [creatingTicketForCluster, setCreatingTicketForCluster] = useState<string | null>(null)

  const filtered = tickets.filter((t) => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false
    if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false
    return true
  })

  async function runClusterIssues() {
    setClustering(true)
    setClusters([])
    try {
      const res = await fetch('/api/ai/cluster-issues', { method: 'POST' })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Erro')
      setClusters(json.clusters)
      if (json.clusters.length === 0) {
        toast.success('Nenhum problema comum identificado.')
      } else {
        toast.success(`${json.clusters.length} grupo(s) de problemas identificado(s)`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao agrupar problemas.')
    } finally {
      setClustering(false)
    }
  }

  async function createTicketFromCluster(cluster: IssueCluster) {
    setCreatingTicketForCluster(cluster.issue_title)
    try {
      const affectedNames = cluster.customers.map((c) => c.name).join(', ')
      const { error } = await supabase.from('tickets').insert({
        customer_id: cluster.customer_ids[0],
        title: cluster.issue_title,
        description: `${cluster.issue_description}\n\nClientes afetados: ${affectedNames}\n\nExemplo: ${cluster.example_summary}`,
        priority: 'high',
        status: 'open',
        tags: ['cluster-ia', 'multiplos-clientes'],
      })
      if (error) throw error
      toast.success('Ticket criado!')
      router.refresh()
    } catch {
      toast.error('Erro ao criar ticket.')
    } finally {
      setCreatingTicketForCluster(null)
    }
  }

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
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--foreground)' }}>
            Tickets
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
            {tickets.filter((t) => t.status === 'open').length} abertos · {tickets.length} total
          </p>
        </div>
        <Button
          onClick={runClusterIssues}
          disabled={clustering}
          className="h-9 gap-1.5 rounded-lg text-[13px] font-medium"
          style={{ background: 'var(--primary)', color: '#fff' }}
        >
          {clustering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {clustering ? 'A analisar…' : 'Agrupar problemas'}
        </Button>
      </div>

      {/* AI Cluster cards */}
      {clusters.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <Sparkles className="h-3.5 w-3.5" style={{ color: 'var(--primary)' }} />
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--primary)' }}>
              Grupos detetados por IA · {clusters.length}
            </span>
          </div>
          {clusters.map((cluster) => (
            <div
              key={cluster.issue_title}
              className="rounded-xl p-5 space-y-3"
              style={{ background: 'var(--card)', border: '1px solid rgba(91,91,214,0.25)', boxShadow: 'var(--shadow-card)' }}
            >
              <div className="flex items-start gap-2">
                <Users className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'var(--primary)' }} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[14px]" style={{ color: 'var(--foreground)' }}>
                    {cluster.customers.length} clientes — {cluster.issue_title}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--muted-foreground)' }}>
                    {cluster.issue_description}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {cluster.customers.map((c) => (
                  <span
                    key={c.id}
                    className="text-[11px] font-medium rounded-full px-2.5 py-0.5"
                    style={{ background: 'rgba(91,91,214,0.1)', color: 'var(--primary)' }}
                  >
                    {c.name}{c.company ? ` · ${c.company}` : ''}
                  </span>
                ))}
              </div>

              <p className="text-xs italic" style={{ color: 'var(--muted-foreground)' }}>
                &ldquo;{cluster.example_summary}&rdquo;
              </p>

              <div className="flex gap-2 pt-1">
                <Button
                  onClick={() => createTicketFromCluster(cluster)}
                  disabled={creatingTicketForCluster === cluster.issue_title}
                  className="h-8 rounded-lg text-[12px] font-medium px-3 gap-1.5"
                  style={{ background: 'var(--primary)', color: '#fff' }}
                >
                  {creatingTicketForCluster === cluster.issue_title && <Loader2 className="h-3 w-3 animate-spin" />}
                  Criar ticket
                </Button>
                <Button
                  onClick={() => setBulkEmailCluster(cluster)}
                  variant="outline"
                  className="h-8 rounded-lg text-[12px] font-medium px-3 gap-1.5"
                  style={{ border: '1px solid var(--border)', color: 'var(--foreground)', background: 'transparent' }}
                >
                  <Mail className="h-3.5 w-3.5" /> Enviar email a todos
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

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

      {bulkEmailCluster && (
        <BulkEmailDialog
          open={!!bulkEmailCluster}
          cluster={bulkEmailCluster}
          onClose={() => setBulkEmailCluster(null)}
        />
      )}
    </div>
  )
}
