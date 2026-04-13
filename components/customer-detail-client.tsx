'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Mail, MessageSquare, Video,
  Plus, ExternalLink, Heart, Building2, Tag,
  CheckCircle2, Circle, Pencil, ArrowLeft, ClipboardPaste,
  Sparkles, Loader2, ChevronDown, ChevronUp, RefreshCw, Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import {
  cn, STATUS_STYLES, STATUS_LABELS, PRIORITY_STYLES,
  healthColor, URGENCY_STYLES, formatDateTime, dueDateLabel,
} from '@/lib/utils'
import { CHANNEL_CONFIG } from '@/lib/channel-config'
import type { CustomerWithIdentifiers, Interaction, FollowUp, Ticket } from '@/lib/database.types'
import { AddInteractionDialog } from '@/components/add-interaction-dialog'
import { AddFollowUpDialog } from '@/components/add-follow-up-dialog'
import { TicketBuilderDialog } from '@/components/ticket-builder-dialog'
import { EditCustomerDialog } from '@/components/edit-customer-dialog'
import { BubblesVideoModal } from '@/components/bubbles-video-modal'
import { PasteConversationDialog } from '@/components/paste-conversation-dialog'
import { SendEmailDialog } from '@/components/send-email-dialog'
import { OnboardingDialog } from '@/components/onboarding-dialog'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import Link from 'next/link'

interface Props {
  customer: CustomerWithIdentifiers
  interactions: Interaction[]
  followUps: FollowUp[]
  tickets: Ticket[]
}

const TRUNCATE_LEN = 400

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&[a-z]+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

type ThreadItem =
  | { kind: 'single'; i: Interaction }
  | { kind: 'thread'; messages: Interaction[] }

const THREAD_GAP_MS = 12 * 60 * 60 * 1000 // 12 h — split thread if gap > 12h

function groupTimeline(interactions: Interaction[]): ThreadItem[] {
  const result: ThreadItem[] = []
  let idx = 0
  while (idx < interactions.length) {
    const curr = interactions[idx]
    if (curr.type !== 'whatsapp') {
      result.push({ kind: 'single', i: curr })
      idx++
    } else {
      const thread: Interaction[] = [curr]
      while (idx + 1 < interactions.length && interactions[idx + 1].type === 'whatsapp') {
        // interactions are newest-first → next item is older; currTime - nextTime = gap
        const currTime = new Date(interactions[idx].occurred_at).getTime()
        const nextTime = new Date(interactions[idx + 1].occurred_at).getTime()
        if (currTime - nextTime > THREAD_GAP_MS) break
        idx++
        thread.push(interactions[idx])
      }
      result.push({ kind: 'thread', messages: [...thread].reverse() }) // oldest→newest
      idx++
    }
  }
  return result
}


export function CustomerDetailClient({ customer, interactions, followUps, tickets }: Props) {
  const router = useRouter()
  const [showAddInteraction,    setShowAddInteraction]    = useState(false)
  const [showAddFollowUp,       setShowAddFollowUp]       = useState(false)
  const [showTicketBuilder,     setShowTicketBuilder]     = useState(false)
  const [showEditCustomer,      setShowEditCustomer]      = useState(false)
  const [showPasteConversation, setShowPasteConversation] = useState(false)
  const [showSendEmail,         setShowSendEmail]         = useState(false)
  const [showOnboarding,        setShowOnboarding]        = useState(false)
  const [bubblesUrl,            setBubblesUrl]            = useState<string | null>(null)
  // Per-interaction: expand + AI bullets
  const [expanded,   setExpanded]   = useState<Set<string>>(new Set())
  const [summaries,  setSummaries]  = useState<Map<string, string[]>>(new Map())
  const [summarizing, setSummarizing] = useState<Set<string>>(new Set())

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const summarizeEmail = useCallback(async (id: string, content: string, subject: string | null) => {
    setSummarizing((prev) => new Set([...prev, id]))
    try {
      const res = await fetch('/api/ai/summarize-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, subject }),
      })
      const text = await res.text()
      let json: { ok: boolean; bullets?: string[]; error?: string }
      try { json = JSON.parse(text) } catch { throw new Error('Servidor sem resposta.') }
      if (!json.ok) throw new Error(json.error ?? 'Erro')
      setSummaries((prev) => new Map([...prev, [id, json.bullets ?? []]]))
    } catch {
      // silent fail — user can retry
    } finally {
      setSummarizing((prev) => { const n = new Set(prev); n.delete(id); return n })
    }
  }, [])

  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function deleteInteraction(id: string) {
    setDeletingId(id)
    const { error } = await supabase.from('interactions').delete().eq('id', id)
    if (error) { toast.error('Erro ao apagar.'); setDeletingId(null); return }
    toast.success('Interação apagada.')
    setDeletingId(null)
    refresh()
  }

  const [syncingEmails, setSyncingEmails] = useState(false)

  async function syncEmails() {
    setSyncingEmails(true)
    try {
      const res = await fetch('/api/imap/sync-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_ids: [customer.id] }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      toast.success(json.message)
      if (json.synced > 0) router.refresh()
    } catch (err) {
      toast.error('Erro ao sincronizar emails.')
      console.error(err)
    } finally {
      setSyncingEmails(false)
    }
  }

  const openFollowUps = followUps.filter((f) => f.status === 'open')
  const doneFollowUps = followUps.filter((f) => f.status === 'done')
  const openTickets   = tickets.filter((t) => t.status === 'open' || t.status === 'in-progress')
  const statusStyle   = STATUS_STYLES[customer.status]
  const refresh       = () => router.refresh()

  type AISummary = { situation: string; urgency: 'critical' | 'high' | 'normal' | 'good'; next_action: string }
  const [aiSummary,        setAiSummary]        = useState<AISummary | null>(null)
  const [loadingSummary,   setLoadingSummary]   = useState(false)

  const fetchSummary = useCallback(async () => {
    if (interactions.length === 0) return
    setLoadingSummary(true)
    try {
      const res = await fetch('/api/ai/customer-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: customer.name,
          customer_company: customer.company,
          open_follow_ups: openFollowUps.length,
          open_tickets: openTickets.length,
          interactions: interactions.slice(0, 10).map((i) => ({
            type: i.type,
            direction: i.direction,
            subject: i.subject,
            content: i.content,
            occurred_at: i.occurred_at,
          })),
        }),
      })
      const text = await res.text()
      let json: { ok: boolean } & Partial<AISummary>
      try { json = JSON.parse(text) } catch { return }
      if (json.ok && json.situation) {
        setAiSummary({ situation: json.situation, urgency: json.urgency ?? 'normal', next_action: json.next_action ?? '' })
      }
    } finally {
      setLoadingSummary(false)
    }
  }, [customer.name, customer.company, interactions, openFollowUps.length, openTickets.length])

  async function toggleFollowUp(id: string, current: string) {
    const next = current === 'done' ? 'open' : 'done'
    const { error } = await supabase
      .from('follow_ups')
      .update({ status: next, completed_at: next === 'done' ? new Date().toISOString() : null })
      .eq('id', id)
    if (error) { toast.error('Erro ao atualizar.'); return }
    toast.success(next === 'done' ? 'Concluído!' : 'Reaberto.')
    refresh()
  }

  return (
    <div className="p-7 max-w-[1000px] mx-auto space-y-6 animate-fade-in">

      {/* Back */}
      <Link
        href="/customers"
        className="inline-flex items-center gap-1.5 text-xs font-medium transition-colors hover:opacity-70"
        style={{ color: 'var(--muted-foreground)' }}
      >
        <ArrowLeft className="h-3 w-3" /> Clientes
      </Link>

      {/* Header card */}
      <div
        className="rounded-xl p-6"
        style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}
      >
        <div className="flex items-start justify-between gap-4">
          {/* Identity */}
          <div className="space-y-2 flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
                {customer.name}
              </h1>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium"
                style={{ background: statusStyle.bg, color: statusStyle.text }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusStyle.dot }} />
                {STATUS_LABELS[customer.status]}
              </span>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {customer.company && (
                <span className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  <Building2 className="h-3.5 w-3.5 shrink-0" /> {customer.company}
                </span>
              )}
              {customer.plan && (
                <span className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  <Tag className="h-3.5 w-3.5 shrink-0" /> {customer.plan}
                </span>
              )}
              <span className={cn('flex items-center gap-1.5 text-sm font-medium', healthColor(customer.health_score))}>
                <Heart className="h-3.5 w-3.5 fill-current" /> {customer.health_score}/5
              </span>
            </div>

            {/* Identifiers */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {customer.customer_identifiers.map((i) => (
                <span
                  key={i.id}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-mono"
                  style={{
                    background: i.is_primary ? 'rgba(91,91,214,0.08)' : 'var(--muted)',
                    color: i.is_primary ? 'var(--primary)' : 'var(--muted-foreground)',
                    border: `1px solid ${i.is_primary ? 'rgba(91,91,214,0.2)' : 'var(--border)'}`,
                  }}
                >
                  {i.type === 'email' && <Mail className="h-3 w-3" />}
                  {(i.type === 'phone' || i.type === 'whatsapp') && <MessageSquare className="h-3 w-3" />}
                  {i.value}
                </span>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 flex-wrap justify-end shrink-0">
            <ActionBtn icon={Pencil}         label="Editar"          onClick={() => setShowEditCustomer(true)} />
            <ActionBtn icon={Mail}           label="Enviar email"    onClick={() => setShowSendEmail(true)} />
            <ActionBtn icon={ClipboardPaste} label="Colar conversa"  onClick={() => setShowPasteConversation(true)} />
            <ActionBtn icon={Plus}           label="Follow-up"       onClick={() => setShowAddFollowUp(true)} />
            <ActionBtn icon={Plus}           label="Interação"       onClick={() => setShowAddInteraction(true)} />
            <ActionBtn icon={CheckCircle2}   label="Onboarding"      onClick={() => setShowOnboarding(true)} />
            <button
              onClick={syncEmails}
              disabled={syncingEmails}
              title="Sincronizar emails deste cliente"
              className="h-8 w-8 flex items-center justify-center rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
              style={{ background: 'var(--muted)', color: 'var(--muted-foreground)', border: '1px solid var(--border)' }}
            >
              {syncingEmails
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
            </button>
            <Button
              size="sm"
              onClick={() => setShowTicketBuilder(true)}
              className="h-8 gap-1.5 rounded-lg text-[12.5px] font-medium"
              style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              <Plus className="h-3.5 w-3.5" /> Ticket
            </Button>
          </div>
        </div>

        {customer.notes && (
          <div
            className="mt-4 p-3 rounded-lg text-sm"
            style={{
              background: 'var(--muted)',
              color: 'var(--muted-foreground)',
              borderLeft: '3px solid var(--border)',
            }}
          >
            {customer.notes}
          </div>
        )}
      </div>

      {/* AI Situation Summary */}
      {(() => {
        const style = aiSummary ? URGENCY_STYLES[aiSummary.urgency] : URGENCY_STYLES.normal

        return (
          <div
            className="rounded-xl px-5 py-4"
            style={{ background: aiSummary ? style.bg : 'var(--card)', border: `1px solid ${aiSummary ? style.border : 'var(--border)'}`, minHeight: 64 }}
          >
            {loadingSummary && !aiSummary && (
              <div className="flex items-center gap-2" style={{ color: 'var(--muted-foreground)' }}>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span className="text-[13px]">A analisar situação…</span>
              </div>
            )}
            {aiSummary && (
              <div className="flex items-start gap-3">
                <div className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ background: style.dot }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--primary)' }}>
                      Situação atual
                    </span>
                    {style.label && (
                      <span className="text-[10px] font-bold uppercase tracking-wider rounded-full px-1.5 py-0.5" style={{ background: `${style.dot}20`, color: style.dot }}>
                        {style.label}
                      </span>
                    )}
                  </div>
                  <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--foreground)' }}>
                    {aiSummary.situation}
                  </p>
                  {aiSummary.next_action && (
                    <p className="text-[12px] mt-1.5 flex items-center gap-1.5" style={{ color: style.dot === 'var(--primary)' ? 'var(--primary)' : style.dot }}>
                      <Sparkles className="h-3 w-3 shrink-0" />
                      {aiSummary.next_action}
                    </p>
                  )}
                </div>
                <button
                  onClick={fetchSummary}
                  disabled={loadingSummary}
                  className="shrink-0 h-6 w-6 flex items-center justify-center rounded-md transition-opacity hover:opacity-70 disabled:opacity-40"
                  style={{ color: 'var(--muted-foreground)' }}
                  title="Atualizar"
                >
                  <RefreshCw className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        )
      })()}

      {/* Tabs */}
      <Tabs defaultValue="timeline">
        <TabsList
          className="rounded-lg p-1 h-auto gap-0.5"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <TabsTrigger value="timeline" className="rounded-md text-[13px] px-4 py-1.5">
            Timeline ({interactions.length})
          </TabsTrigger>
          <TabsTrigger value="followups" className="rounded-md text-[13px] px-4 py-1.5">
            Follow-ups ({openFollowUps.length})
          </TabsTrigger>
          <TabsTrigger value="tickets" className="rounded-md text-[13px] px-4 py-1.5">
            Tickets ({tickets.length})
          </TabsTrigger>
        </TabsList>

        {/* TIMELINE */}
        <TabsContent value="timeline" className="mt-5 space-y-3">
          {/* Context summary strip */}
          {interactions.length > 0 && (() => {
            const lastInteraction = interactions[0]
            const lastInbound = interactions.find((i) => i.direction === 'inbound')
            const openTicketsCount = tickets.filter((t) => t.status === 'open' || t.status === 'in-progress').length
            const openFUCount = openFollowUps.length
            const daysSinceLast = lastInteraction
              ? Math.floor((Date.now() - new Date(lastInteraction.occurred_at).getTime()) / 86_400_000)
              : null
            const daysSinceInbound = lastInbound
              ? Math.floor((Date.now() - new Date(lastInbound.occurred_at).getTime()) / 86_400_000)
              : null

            const urgentColor = (daysSinceInbound ?? 0) >= 7 ? '#EF4444' : (daysSinceInbound ?? 0) >= 3 ? '#F59E0B' : '#2DB975'

            return (
              <div
                className="flex flex-wrap gap-4 rounded-xl px-4 py-3 text-[12.5px]"
                style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
              >
                {daysSinceLast !== null && (
                  <div className="flex items-center gap-1.5" style={{ color: 'var(--muted-foreground)' }}>
                    <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                      {daysSinceLast === 0 ? 'hoje' : `há ${daysSinceLast}d`}
                    </span>
                    último contacto
                    <span style={{ color: CHANNEL_CONFIG[lastInteraction.type]?.color ?? 'var(--muted-foreground)' }}>
                      ({CHANNEL_CONFIG[lastInteraction.type]?.label ?? lastInteraction.type})
                    </span>
                  </div>
                )}
                {daysSinceInbound !== null && (
                  <div className="flex items-center gap-1.5" style={{ color: 'var(--muted-foreground)' }}>
                    <span className="font-medium" style={{ color: urgentColor }}>
                      {daysSinceInbound === 0 ? 'hoje' : `há ${daysSinceInbound}d`}
                    </span>
                    último inbound
                  </div>
                )}
                <div className="flex items-center gap-1.5" style={{ color: 'var(--muted-foreground)' }}>
                  <span className="font-medium" style={{ color: openFUCount > 0 ? '#F59E0B' : 'var(--muted-foreground)' }}>
                    {openFUCount}
                  </span>
                  follow-up{openFUCount !== 1 ? 's' : ''} aberto{openFUCount !== 1 ? 's' : ''}
                </div>
                <div className="flex items-center gap-1.5" style={{ color: 'var(--muted-foreground)' }}>
                  <span className="font-medium" style={{ color: openTicketsCount > 0 ? '#EF4444' : 'var(--muted-foreground)' }}>
                    {openTicketsCount}
                  </span>
                  ticket{openTicketsCount !== 1 ? 's' : ''} aberto{openTicketsCount !== 1 ? 's' : ''}
                </div>
                <div className="flex items-center gap-1.5" style={{ color: 'var(--muted-foreground)' }}>
                  <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                    {interactions.length}
                  </span>
                  interações no total
                </div>
              </div>
            )
          })()}

          {interactions.length === 0 && (
            <EmptyState message="Sem interações registadas. Adiciona a primeira." />
          )}
          {groupTimeline(interactions).map((item, itemIdx) => {
            if (item.kind === 'single') {
              const i = item.i
              const ch = CHANNEL_CONFIG[i.type] ?? CHANNEL_CONFIG.note
              const Icon = ch.icon
              return (
                <div key={i.id} className="group flex gap-3.5 animate-fade-in">
                  {/* Icon bubble */}
                  <div className="flex flex-col items-center">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: ch.bg }}
                    >
                      <Icon className="h-4 w-4" style={{ color: ch.color }} />
                    </div>
                  </div>

                  {/* Content */}
                  <div
                    className="flex-1 rounded-xl p-4 space-y-2"
                    style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="text-[11px] font-semibold uppercase tracking-wide"
                            style={{ color: ch.color }}
                          >
                            {ch.label}
                          </span>
                          {i.direction && (
                            <span
                              className="text-[10px] rounded-full px-1.5 py-0.5"
                              style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}
                            >
                              {i.direction === 'inbound' ? '↓ recebido' : '↑ enviado'}
                            </span>
                          )}
                        </div>
                        {i.subject && (
                          <p className="font-medium text-[14px]" style={{ color: 'var(--foreground)' }}>
                            {i.subject}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
                          {formatDateTime(i.occurred_at)}
                        </span>
                        <button
                          onClick={() => deleteInteraction(i.id)}
                          disabled={deletingId === i.id}
                          className="transition-opacity hover:opacity-100 p-0.5 rounded"
                          style={{ color: 'var(--muted-foreground)', opacity: 0.35 }}
                          title="Apagar interação"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    {i.content && (() => {
                      const isEmail = i.type === 'email'
                      const cleaned = isEmail ? stripHtml(i.content) : i.content
                      const isLong = cleaned.length > TRUNCATE_LEN
                      const isExpanded = expanded.has(i.id)
                      const displayText = isLong && !isExpanded ? cleaned.slice(0, TRUNCATE_LEN) + '…' : cleaned
                      const bullets = summaries.get(i.id)
                      const isSummarizing = summarizing.has(i.id)

                      return (
                        <div className="space-y-2">
                          {/* AI bullets */}
                          {bullets && bullets.length > 0 && (
                            <ul className="space-y-1 rounded-lg p-3" style={{ background: 'rgba(91,91,214,0.06)', border: '1px solid rgba(91,91,214,0.15)' }}>
                              {bullets.map((b, bi) => (
                                <li key={bi} className="flex items-start gap-2 text-[12.5px]" style={{ color: 'var(--foreground)' }}>
                                  <span className="mt-[3px] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--primary)' }} />
                                  {b}
                                </li>
                              ))}
                            </ul>
                          )}

                          <p
                            className="text-sm leading-relaxed whitespace-pre-wrap"
                            style={{ color: 'var(--muted-foreground)' }}
                          >
                            {displayText}
                          </p>

                          {/* Expand / AI button row */}
                          <div className="flex items-center gap-2">
                            {isLong && (
                              <button
                                onClick={() => toggleExpand(i.id)}
                                className="flex items-center gap-1 text-[11px] font-medium transition-opacity hover:opacity-70"
                                style={{ color: 'var(--primary)' }}
                              >
                                {isExpanded
                                  ? <><ChevronUp className="h-3 w-3" /> Ver menos</>
                                  : <><ChevronDown className="h-3 w-3" /> Ver mais</>}
                              </button>
                            )}
                            {isEmail && !bullets && (
                              <button
                                onClick={() => summarizeEmail(i.id, i.content!, i.subject)}
                                disabled={isSummarizing}
                                className="flex items-center gap-1 text-[11px] font-medium transition-opacity hover:opacity-70"
                                style={{ color: 'var(--muted-foreground)' }}
                              >
                                {isSummarizing
                                  ? <><Loader2 className="h-3 w-3 animate-spin" /> A resumir…</>
                                  : <><Sparkles className="h-3 w-3" /> Resumir</>}
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })()}

                    {/* Bubbles embed */}
                    {i.bubbles_url && (
                      <div
                        className="flex items-center gap-3 rounded-lg px-3 py-2.5 mt-1"
                        style={{
                          background: 'rgba(139,92,246,0.08)',
                          border: '1px solid rgba(139,92,246,0.2)',
                        }}
                      >
                        <Video className="h-4 w-4 shrink-0" style={{ color: '#8B5CF6' }} />
                        <span className="text-sm font-medium flex-1 truncate" style={{ color: '#6D28D9' }}>
                          {i.bubbles_title ?? 'Gravação Bubbles'}
                        </span>
                        <div className="flex gap-1.5 shrink-0">
                          <button
                            onClick={() => setBubblesUrl(i.bubbles_url!)}
                            className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
                            style={{
                              background: 'rgba(139,92,246,0.15)',
                              color: '#7C3AED',
                            }}
                          >
                            Ver vídeo
                          </button>
                          <a href={i.bubbles_url} target="_blank" rel="noopener noreferrer">
                            <button
                              className="p-1 rounded-md transition-colors hover:opacity-70"
                              style={{ color: '#8B5CF6' }}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </button>
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            }

            // WhatsApp thread
            const { messages } = item
            const newestMsg = messages[messages.length - 1]
            const dateLabel = new Date(newestMsg.occurred_at).toLocaleDateString('pt-PT', {
              day: 'numeric', month: 'long', year: 'numeric',
            })
            return (
              <div key={`thread-${itemIdx}`} className="flex gap-3.5 animate-fade-in">
                {/* WhatsApp icon */}
                <div className="flex flex-col items-center">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: 'rgba(45,185,117,0.1)' }}
                  >
                    <MessageSquare className="h-4 w-4" style={{ color: '#2DB975' }} />
                  </div>
                </div>

                {/* Thread card */}
                <div
                  className="flex-1 rounded-xl overflow-hidden"
                  style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}
                >
                  {/* Thread header */}
                  <div
                    className="flex items-center justify-between px-4 py-2.5"
                    style={{ borderBottom: '1px solid var(--border)' }}
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#2DB975' }}>
                      WhatsApp · {messages.length} mensagem{messages.length !== 1 ? 's' : ''}
                    </span>
                    <span className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
                      {dateLabel}
                    </span>
                  </div>

                  {/* Chat bubbles */}
                  <div className="p-3 space-y-2">
                    {messages.map((m) => {
                      const isOut = m.direction === 'outbound'
                      return (
                        <div key={m.id} className={`group flex flex-col gap-0.5 ${isOut ? 'items-end' : 'items-start'}`}>
                          <div
                            className="max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap"
                            style={isOut
                              ? { background: 'rgba(91,91,214,0.12)', color: 'var(--foreground)', borderBottomRightRadius: 4 }
                              : { background: 'rgba(45,185,117,0.1)', color: 'var(--foreground)', borderBottomLeftRadius: 4 }}
                          >
                            {m.content}
                          </div>
                          <div className={`flex items-center gap-1 px-1 ${isOut ? 'flex-row-reverse' : ''}`}>
                            <span className="text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
                              {new Date(m.occurred_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <button
                              onClick={() => deleteInteraction(m.id)}
                              disabled={deletingId === m.id}
                              className="opacity-0 group-hover:opacity-100 transition-opacity hover:opacity-70"
                              style={{ color: 'var(--muted-foreground)' }}
                              title="Apagar mensagem"
                            >
                              <Trash2 className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}
        </TabsContent>

        {/* FOLLOW-UPS */}
        <TabsContent value="followups" className="mt-5 space-y-2">
          {openFollowUps.length === 0 && doneFollowUps.length === 0 && (
            <EmptyState message="Sem follow-ups. Cria o primeiro." />
          )}
          {openFollowUps.map((f) => (
            <FollowUpRow key={f.id} f={f} onToggle={toggleFollowUp} />
          ))}
          {doneFollowUps.length > 0 && (
            <>
              <Separator className="my-3" style={{ background: 'var(--border)' }} />
              <p className="text-[11px] font-semibold uppercase tracking-wide px-1 pb-1" style={{ color: 'var(--muted-foreground)' }}>
                Concluídos
              </p>
              {doneFollowUps.map((f) => (
                <FollowUpRow key={f.id} f={f} onToggle={toggleFollowUp} />
              ))}
            </>
          )}
        </TabsContent>

        {/* TICKETS */}
        <TabsContent value="tickets" className="mt-5 space-y-3">
          {tickets.length === 0 && <EmptyState message="Sem tickets." />}
          {tickets.map((t) => {
            const ps = PRIORITY_STYLES[t.priority]
            return (
              <div
                key={t.id}
                className="rounded-xl p-4 space-y-2"
                style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>
                    {t.title}
                  </p>
                  <div className="flex gap-1.5 shrink-0">
                    <span
                      className="text-[11px] font-medium rounded-full px-2 py-0.5"
                      style={{ background: ps.bg, color: ps.text }}
                    >
                      {t.priority}
                    </span>
                    <span
                      className="text-[11px] font-medium rounded-full px-2 py-0.5"
                      style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}
                    >
                      {t.status}
                    </span>
                  </div>
                </div>
                {t.description && (
                  <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{t.description}</p>
                )}
                {t.tags.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {t.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md px-2 py-0.5 text-[11px]"
                        style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <AddInteractionDialog    open={showAddInteraction}    customerId={customer.id} onClose={() => { setShowAddInteraction(false);    refresh() }} />
      <AddFollowUpDialog       open={showAddFollowUp}       customerId={customer.id} customerName={customer.name} customerCompany={customer.company} interactions={interactions.slice(0, 8).map((i) => ({ type: i.type, direction: i.direction, subject: i.subject, content: i.content, occurred_at: i.occurred_at }))} onClose={() => { setShowAddFollowUp(false);       refresh() }} />
      <TicketBuilderDialog     open={showTicketBuilder}     customer={customer}     interactions={interactions}     onClose={() => { setShowTicketBuilder(false);     refresh() }} />
      <EditCustomerDialog      open={showEditCustomer}      customer={customer}      onClose={() => { setShowEditCustomer(false);      refresh() }} />
      <PasteConversationDialog open={showPasteConversation} customerId={customer.id} onClose={() => { setShowPasteConversation(false); refresh() }} />
      <SendEmailDialog
        open={showSendEmail}
        customerId={customer.id}
        customerEmail={customer.customer_identifiers.find((i) => i.type === 'email')?.value ?? ''}
        customerName={customer.name}
        customerCompany={customer.company}
        interactions={interactions}
        allEmails={customer.customer_identifiers
          .filter((i) => i.type === 'email')
          .map((i) => ({ label: customer.name, email: i.value }))}
        onClose={() => { setShowSendEmail(false); refresh() }}
      />
      <BubblesVideoModal url={bubblesUrl} onClose={() => setBubblesUrl(null)} />
      <OnboardingDialog
        open={showOnboarding}
        customerId={customer.id}
        customerName={customer.name}
        customerEmail={customer.customer_identifiers.find((i) => i.type === 'email')?.value ?? null}
        onClose={() => { setShowOnboarding(false); refresh() }}
      />
    </div>
  )
}

function FollowUpRow({ f, onToggle }: { f: FollowUp; onToggle: (id: string, s: string) => void }) {
  const { label, color } = dueDateLabel(f.due_date)
  const done = f.status === 'done'
  const ps   = PRIORITY_STYLES[f.priority]
  return (
    <div
      className="flex items-start gap-3 rounded-xl p-4 transition-opacity"
      style={{
        background: 'var(--card)',
        boxShadow: 'var(--shadow-card)',
        opacity: done ? 0.5 : 1,
      }}
    >
      <button onClick={() => onToggle(f.id, f.status)} className="mt-0.5 shrink-0">
        {done
          ? <CheckCircle2 className="h-[18px] w-[18px]" style={{ color: '#2DB975' }} />
          : <Circle       className="h-[18px] w-[18px] transition-colors hover:text-emerald-400" style={{ color: 'var(--border)' }} />}
      </button>
      <div className="flex-1 min-w-0">
        <p
          className={cn('text-sm font-medium', done && 'line-through')}
          style={{ color: done ? 'var(--muted-foreground)' : 'var(--foreground)' }}
        >
          {f.title}
        </p>
        {f.description && (
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted-foreground)' }}>
            {f.description}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span
          className="text-[11px] font-medium rounded-full px-2 py-0.5"
          style={{ background: ps.bg, color: ps.text }}
        >
          {f.priority}
        </span>
        <span className="text-[11px]" style={{ color }}>
          {label}
        </span>
      </div>
    </div>
  )
}

function ActionBtn({ icon: Icon, label, onClick }: { icon: React.ElementType; label: string; onClick: () => void }) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onClick}
      className="h-8 gap-1.5 rounded-lg text-[12.5px] font-medium"
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        color: 'var(--foreground)',
      }}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </Button>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl p-8 text-center"
      style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}
    >
      <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{message}</p>
    </div>
  )
}
