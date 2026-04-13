'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, Circle, AlertTriangle, Clock, CalendarDays, Sparkles, Loader2 } from 'lucide-react'
import { cn, dueDateLabel, PRIORITY_STYLES } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { FollowUp } from '@/lib/database.types'

type FollowUpWithCustomer = FollowUp & { customers: { id: string; name: string; company: string | null } | null }

type CommitmentSuggestion = {
  customer_id: string
  interaction_type: string
  commitment_text: string
  suggested_title: string
  suggested_priority: 'low' | 'medium' | 'high' | 'urgent'
  customer_name: string
  customer_company: string | null
}

const CHANNEL_LABELS: Record<string, string> = {
  email: '📧 email',
  whatsapp: '💬 WhatsApp',
  meeting: '🎥 reunião',
  call: '📞 chamada',
  note: '📝 nota',
}

type EmailInteraction = {
  customer_id: string
  direction: string | null
  subject: string | null
  occurred_at: string
  customers: { id: string; name: string; company: string | null; company_id: string | null } | { id: string; name: string; company: string | null; company_id: string | null }[] | null
}

type NeedsReplyEntry = {
  customerId: string
  name: string
  company: string | null
  subject: string | null
  occurred_at: string
  daysWaiting: number
}

type TriageResult = {
  customer_id: string
  priority: 'urgent' | 'high' | 'medium' | 'low'
  category: string
  summary: string
  action: string
}

const PRIORITY_ORDER_MAP = { urgent: 0, high: 1, medium: 2, low: 3 }
const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 }

const CATEGORY_COLORS: Record<string, string> = {
  suporte: '#EF4444',
  comercial: '#8B5CF6',
  financeiro: '#F59E0B',
  feedback: '#3B82F6',
  'reunião': '#10B981',
  informação: '#6B7280',
  outro: '#6B7280',
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#EF4444',
  high: '#F59E0B',
  medium: '#3B82F6',
  low: '#6B7280',
}

function resolveCustomer(raw: EmailInteraction['customers']): { id: string; name: string; company: string | null } | null {
  if (!raw) return null
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw
}

export function FollowUpsClient({
  followUps,
  emailInteractions = [],
}: {
  followUps: FollowUpWithCustomer[]
  emailInteractions?: EmailInteraction[]
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [tab, setTab] = useState(params.get('filter') ?? 'reply')
  const [triaging, setTriaging] = useState(false)
  const [triageMap, setTriageMap] = useState<Map<string, TriageResult>>(new Map())
  const [detectingCommitments, setDetectingCommitments] = useState(false)
  const [commitmentSuggestions, setCommitmentSuggestions] = useState<CommitmentSuggestion[]>([])
  const [creatingFollowUpId, setCreatingFollowUpId] = useState<string | null>(null)

  const today = new Date().toISOString().split('T')[0]
  const overdue    = followUps.filter((f) => f.status === 'open' && f.due_date && f.due_date < today)
  const todayItems = followUps.filter((f) => f.status === 'open' && f.due_date === today)
  const upcoming   = followUps.filter((f) => f.status === 'open' && (!f.due_date || f.due_date > today))
  const done       = followUps.filter((f) => f.status === 'done')
  const openCount  = overdue.length + todayItems.length + upcoming.length

  // Smart "needs reply": most recent email per customer, inbound only
  const needsReply = useMemo<NeedsReplyEntry[]>(() => {
    const byCustomer = new Map<string, EmailInteraction>()
    for (const ei of emailInteractions) {
      if (!byCustomer.has(ei.customer_id)) byCustomer.set(ei.customer_id, ei)
    }
    const now = Date.now()
    const entries: NeedsReplyEntry[] = []
    for (const [customerId, ei] of byCustomer) {
      if (ei.direction !== 'inbound') continue
      const customer = resolveCustomer(ei.customers)
      if (!customer) continue
      const daysWaiting = Math.floor((now - new Date(ei.occurred_at).getTime()) / 86_400_000)
      entries.push({ customerId, name: customer.name, company: customer.company, subject: ei.subject, occurred_at: ei.occurred_at, daysWaiting })
    }
    // If triage available, sort by AI priority; otherwise by days waiting
    if (triageMap.size > 0) {
      return entries.sort((a, b) => {
        const pa = triageMap.get(a.customerId)?.priority ?? 'low'
        const pb = triageMap.get(b.customerId)?.priority ?? 'low'
        return PRIORITY_ORDER_MAP[pa] - PRIORITY_ORDER_MAP[pb]
      })
    }
    return entries.sort((a, b) => b.daysWaiting - a.daysWaiting)
  }, [emailInteractions, triageMap])

  async function runTriage() {
    setTriaging(true)
    try {
      const res = await fetch('/api/ai/triage-inbox', { method: 'POST' })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Erro')
      const map = new Map<string, TriageResult>()
      for (const r of json.results as TriageResult[]) map.set(r.customer_id, r)
      setTriageMap(map)
      toast.success(`${json.results.length} emails analisados por IA`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao analisar emails.')
    } finally {
      setTriaging(false)
    }
  }

  async function runDetectCommitments() {
    setDetectingCommitments(true)
    setCommitmentSuggestions([])
    try {
      const res = await fetch('/api/ai/detect-commitments', { method: 'POST' })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Erro')
      setCommitmentSuggestions(json.results)
      if (json.results.length === 0) {
        toast.success('Nenhum compromisso por cumprir encontrado.')
      } else {
        toast.success(`${json.results.length} compromisso(s) detetado(s)`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao detetar compromissos.')
    } finally {
      setDetectingCommitments(false)
    }
  }

  async function createFollowUpFromSuggestion(s: CommitmentSuggestion) {
    setCreatingFollowUpId(s.customer_id)
    try {
      const { error } = await supabase.from('follow_ups').insert({
        customer_id: s.customer_id,
        title: s.suggested_title,
        description: `Compromisso detetado por IA (${CHANNEL_LABELS[s.interaction_type] ?? s.interaction_type}): "${s.commitment_text}"`,
        priority: s.suggested_priority,
      })
      if (error) throw error
      toast.success('Follow-up criado!')
      setCommitmentSuggestions((prev) => prev.filter((x) => x.customer_id !== s.customer_id))
      router.refresh()
    } catch {
      toast.error('Erro ao criar follow-up.')
    } finally {
      setCreatingFollowUpId(null)
    }
  }

  async function toggle(id: string, current: string) {
    const next = current === 'done' ? 'open' : 'done'
    const { error } = await supabase.from('follow_ups').update({
      status: next,
      completed_at: next === 'done' ? new Date().toISOString() : null,
    }).eq('id', id)
    if (error) { toast.error('Erro.'); return }
    toast.success(next === 'done' ? 'Concluído!' : 'Reaberto.')
    router.refresh()
  }

  const tabs = [
    { key: 'reply', label: `Sem resposta (${needsReply.length})` },
    { key: 'open',  label: `Follow-ups (${openCount})` },
    { key: 'done',  label: `Concluídos (${done.length})` },
  ]

  return (
    <div className="p-7 max-w-[780px] mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--foreground)' }}>
            Follow-ups
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
            {needsReply.length} sem resposta · {openCount} tarefas abertas · {done.length} concluídas
          </p>
        </div>
        {tab === 'reply' && (
          <Button
            onClick={runTriage}
            disabled={triaging || needsReply.length === 0}
            className="h-9 gap-1.5 rounded-lg text-[13px] font-medium"
            style={{ background: 'var(--primary)', color: '#fff' }}
          >
            {triaging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {triaging ? 'A analisar…' : 'Analisar com IA'}
          </Button>
        )}
        {tab === 'open' && (
          <Button
            onClick={runDetectCommitments}
            disabled={detectingCommitments}
            className="h-9 gap-1.5 rounded-lg text-[13px] font-medium"
            style={{ background: 'var(--primary)', color: '#fff' }}
          >
            {detectingCommitments ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {detectingCommitments ? 'A analisar…' : 'Detetar compromissos'}
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="inline-flex rounded-lg p-1 gap-1" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="rounded-md px-4 py-1.5 text-[13px] font-medium transition-all"
            style={{
              background: tab === key ? 'var(--foreground)' : 'transparent',
              color: tab === key ? 'var(--card)' : 'var(--muted-foreground)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Sem resposta */}
      {tab === 'reply' && (
        <div className="space-y-2">
          {needsReply.length === 0 ? (
            <div className="rounded-xl p-8 text-center" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                Sem emails por responder. Sincroniza o email primeiro.
              </p>
            </div>
          ) : (
            needsReply.map((entry) => {
              const triage = triageMap.get(entry.customerId)
              const dotColor = triage
                ? PRIORITY_COLORS[triage.priority]
                : entry.daysWaiting >= 7 ? '#EF4444' : entry.daysWaiting >= 3 ? '#F59E0B' : '#2DB975'

              return (
                <Link
                  key={entry.customerId}
                  href={`/customers/${entry.customerId}`}
                  className="flex items-start gap-3 rounded-xl p-4 transition-opacity hover:opacity-80"
                  style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)', display: 'flex' }}
                >
                  <div className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: dotColor }} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                        {entry.name}
                      </p>
                      {entry.company && (
                        <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{entry.company}</span>
                      )}
                      {triage && (
                        <span
                          className="text-[10px] font-semibold uppercase rounded-full px-1.5 py-0.5"
                          style={{ background: `${CATEGORY_COLORS[triage.category] ?? '#6B7280'}20`, color: CATEGORY_COLORS[triage.category] ?? '#6B7280' }}
                        >
                          {triage.category}
                        </span>
                      )}
                    </div>

                    {/* AI summary takes priority over subject */}
                    {triage ? (
                      <>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--foreground)', opacity: 0.8 }}>
                          {triage.summary}
                        </p>
                        <p className="text-xs mt-0.5 flex items-center gap-1" style={{ color: 'var(--primary)' }}>
                          <Sparkles className="h-3 w-3" /> {triage.action}
                        </p>
                      </>
                    ) : (
                      entry.subject && (
                        <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted-foreground)' }}>
                          {entry.subject}
                        </p>
                      )
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {triage && (
                      <span
                        className="text-[10px] font-semibold uppercase rounded-full px-2 py-0.5"
                        style={{ background: `${PRIORITY_COLORS[triage.priority]}20`, color: PRIORITY_COLORS[triage.priority] }}
                      >
                        {triage.priority}
                      </span>
                    )}
                    <span
                      className="text-[11px] font-medium rounded-full px-2 py-0.5"
                      style={{
                        background: entry.daysWaiting >= 7 ? 'rgba(239,68,68,0.1)' : entry.daysWaiting >= 3 ? 'rgba(245,158,11,0.1)' : 'rgba(45,185,117,0.1)',
                        color: entry.daysWaiting >= 7 ? '#EF4444' : entry.daysWaiting >= 3 ? '#F59E0B' : '#2DB975',
                      }}
                    >
                      {entry.daysWaiting === 0 ? 'hoje' : `${entry.daysWaiting}d`}
                    </span>
                  </div>
                </Link>
              )
            })
          )}
        </div>
      )}

      {/* Open follow-ups */}
      {tab === 'open' && (
        <div className="space-y-6">
          {/* AI commitment suggestions */}
          {commitmentSuggestions.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <Sparkles className="h-3.5 w-3.5" style={{ color: 'var(--primary)' }} />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--primary)' }}>
                  Sugestões de IA · {commitmentSuggestions.length}
                </span>
              </div>
              {commitmentSuggestions.map((s) => {
                const ps = PRIORITY_STYLES[s.suggested_priority]
                return (
                  <div
                    key={s.customer_id}
                    className="flex items-start gap-3 rounded-xl p-4"
                    style={{ background: 'var(--card)', border: '1px solid rgba(91,91,214,0.25)', boxShadow: 'var(--shadow-card)' }}
                  >
                    <Sparkles className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'var(--primary)' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                        {s.suggested_title}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
                        {s.customer_name}{s.customer_company ? ` · ${s.customer_company}` : ''}
                        {' · '}<span style={{ color: 'var(--primary)', opacity: 0.8 }}>{CHANNEL_LABELS[s.interaction_type] ?? s.interaction_type}</span>
                      </p>
                      <p className="text-xs mt-1 italic" style={{ color: 'var(--muted-foreground)' }}>
                        &ldquo;{s.commitment_text}&rdquo;
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] font-medium rounded-full px-2 py-0.5" style={{ background: ps.bg, color: ps.text }}>
                        {s.suggested_priority}
                      </span>
                      <Button
                        onClick={() => createFollowUpFromSuggestion(s)}
                        disabled={creatingFollowUpId === s.customer_id}
                        className="h-7 rounded-lg text-[12px] font-medium px-3"
                        style={{ background: 'var(--primary)', color: '#fff' }}
                      >
                        {creatingFollowUpId === s.customer_id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Criar'}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {openCount === 0 && commitmentSuggestions.length === 0 && (
            <div className="rounded-xl p-8 text-center" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Sem follow-ups abertos. 🎉</p>
            </div>
          )}
          <Section items={overdue}    label="Atrasados" icon={AlertTriangle} color="var(--status-churned)"   onToggle={toggle} />
          <Section items={todayItems} label="Para hoje"  icon={Clock}        color="#F59E0B"                  onToggle={toggle} />
          <Section items={upcoming}   label="Próximos"   icon={CalendarDays} color="var(--muted-foreground)" onToggle={toggle} />
        </div>
      )}

      {/* Done */}
      {tab === 'done' && (
        <div className="space-y-2">
          {done.length === 0 && (
            <div className="rounded-xl p-8 text-center" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Sem concluídos ainda.</p>
            </div>
          )}
          {done.map((f) => <FollowUpItem key={f.id} f={f} onToggle={toggle} />)}
        </div>
      )}
    </div>
  )
}

function Section({ items, label, icon: Icon, color, onToggle }: {
  items: FollowUpWithCustomer[]
  label: string
  icon: React.ElementType
  color: string
  onToggle: (id: string, s: string) => void
}) {
  if (items.length === 0) return null
  const sorted = [...items].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <Icon className="h-3.5 w-3.5" style={{ color }} />
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color }}>
          {label} · {items.length}
        </span>
      </div>
      {sorted.map((f) => <FollowUpItem key={f.id} f={f} onToggle={onToggle} />)}
    </div>
  )
}

function FollowUpItem({ f, onToggle }: { f: FollowUpWithCustomer; onToggle: (id: string, s: string) => void }) {
  const { label, color } = dueDateLabel(f.due_date)
  const done = f.status === 'done'
  const ps   = PRIORITY_STYLES[f.priority]
  return (
    <div
      className="flex items-start gap-3 rounded-xl p-4 transition-all"
      style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)', opacity: done ? 0.5 : 1 }}
    >
      <button onClick={() => onToggle(f.id, f.status)} className="mt-0.5 shrink-0">
        {done
          ? <CheckCircle2 className="h-[18px] w-[18px]" style={{ color: '#2DB975' }} />
          : <Circle className="h-[18px] w-[18px] transition-colors" style={{ color: 'var(--border)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#2DB975')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--border)')}
            />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-medium', done && 'line-through')} style={{ color: done ? 'var(--muted-foreground)' : 'var(--foreground)' }}>
          {f.title}
        </p>
        {f.description && (
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted-foreground)' }}>{f.description}</p>
        )}
        {f.customers && (
          <Link href={`/customers/${f.customers.id}`} className="text-[11px] font-medium mt-1 inline-block transition-colors hover:opacity-70" style={{ color: 'var(--primary)' }}>
            {f.customers.name}{f.customers.company ? ` · ${f.customers.company}` : ''}
          </Link>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <span className="text-[11px] font-medium rounded-full px-2 py-0.5" style={{ background: ps.bg, color: ps.text }}>{f.priority}</span>
        <span className="text-[11px]" style={{ color }}>{label}</span>
      </div>
    </div>
  )
}
