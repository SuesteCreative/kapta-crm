'use client'

import { useMemo, useState } from 'react'
import {
  Mail, Trash2, Reply, ChevronDown, ChevronUp, Sparkles, Loader2,
  ArrowDownLeft, ArrowUpRight, Circle,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { formatDateTime } from '@/lib/utils'
import { stripHtml } from '@/lib/html-utils'
import { EmailHtmlViewer } from '@/components/email-html-viewer'
import type { Interaction } from '@/lib/database.types'

// ────────────────────────────────────────────────────────────────────────────
// Threading: groups inbound/outbound emails sharing a normalized subject within
// a 30-day window. Standalone non-email interactions render as singles.
// (Stripped variant — does NOT thread WhatsApp; see customer-detail-client for
//  that legacy logic. Use that page for richer multi-channel timelines.)
// ────────────────────────────────────────────────────────────────────────────

export type ThreadItem =
  | { kind: 'single'; i: Interaction }
  | { kind: 'email-thread'; subject: string; messages: Interaction[] }

const EMAIL_THREAD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

function normalizeSubject(raw: string): string {
  let s = raw
  let prev = ''
  while (s !== prev) {
    prev = s
    s = s.replace(/^(re|fw|fwd|res|enc|reen|rv|tr):\s*/gi, '').trim()
  }
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function groupTimeline(interactions: Interaction[]): ThreadItem[] {
  const bySubject = new Map<string, Interaction[]>()
  for (const i of interactions) {
    if (i.type !== 'email' || !i.subject) continue
    const key = normalizeSubject(i.subject)
    if (!bySubject.has(key)) bySubject.set(key, [])
    bySubject.get(key)!.push(i)
  }

  const threaded = new Set<string>()
  const items: Array<{ item: ThreadItem; ts: number }> = []

  for (const [, msgs] of bySubject) {
    const sorted = [...msgs].sort((a, b) =>
      new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
    )
    const oldest = new Date(sorted[0].occurred_at).getTime()
    const newest = new Date(sorted[sorted.length - 1].occurred_at).getTime()
    if (sorted.length >= 2 && newest - oldest <= EMAIL_THREAD_WINDOW_MS) {
      for (const m of sorted) threaded.add(m.id)
      items.push({ item: { kind: 'email-thread', subject: sorted[0].subject!, messages: sorted }, ts: newest })
    }
  }

  for (const i of interactions) {
    if (threaded.has(i.id)) continue
    items.push({ item: { kind: 'single', i }, ts: new Date(i.occurred_at).getTime() })
  }

  return items.sort((a, b) => b.ts - a.ts).map((x) => x.item)
}

// ────────────────────────────────────────────────────────────────────────────

interface Props {
  interactions: Interaction[]
  /** When null, reply button is hidden. */
  onReply?: ((i: Interaction) => void) | null
  /** When false, delete button is hidden. Default true. */
  allowDelete?: boolean
  /** When false, AI summarize button is hidden. Default true. */
  allowSummarize?: boolean
  /** Empty-state copy. */
  emptyLabel?: string
}

export function InteractionsTimeline({
  interactions,
  onReply = null,
  allowDelete = true,
  allowSummarize = true,
  emptyLabel = 'Sem interações ainda.',
}: Props) {
  const router = useRouter()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [summaries, setSummaries] = useState<Record<string, string>>({})
  const [summarizing, setSummarizing] = useState<Record<string, boolean>>({})

  const threadItems = useMemo(() => groupTimeline(interactions), [interactions])

  async function deleteInteraction(id: string) {
    if (!confirm('Apagar este registo?')) return
    try {
      const { error } = await supabase.from('interactions').delete().eq('id', id)
      if (error) throw error
      toast.success('Apagado.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro.')
    }
  }

  async function summarizeEmail(id: string, content: string | null, subject: string | null) {
    if (!content) return
    setSummarizing((s) => ({ ...s, [id]: true }))
    try {
      const res = await fetch('/api/ai/summarize-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: stripHtml(content), subject }),
      })
      const json = await res.json()
      if (json?.summary) setSummaries((s) => ({ ...s, [id]: json.summary }))
    } catch {
      // silent — summarize is best-effort
    } finally {
      setSummarizing((s) => ({ ...s, [id]: false }))
    }
  }

  if (threadItems.length === 0) {
    return (
      <div className="rounded-xl p-10 text-center" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{emptyLabel}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {threadItems.map((item) => {
        if (item.kind === 'single') {
          return (
            <InteractionRow
              key={item.i.id}
              i={item.i}
              expanded={expanded[item.i.id] ?? false}
              summary={summaries[item.i.id]}
              summarizing={summarizing[item.i.id] ?? false}
              onToggleExpand={() => setExpanded((e) => ({ ...e, [item.i.id]: !e[item.i.id] }))}
              onSummarize={allowSummarize ? () => summarizeEmail(item.i.id, item.i.content, item.i.subject) : null}
              onReply={onReply}
              onDelete={allowDelete ? () => deleteInteraction(item.i.id) : null}
            />
          )
        }
        const last = item.messages[item.messages.length - 1]
        return (
          <div key={'th-' + item.subject + '-' + last.id} className="rounded-xl p-4 space-y-2" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Mail className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--muted-foreground)' }} />
                <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--foreground)' }}>
                  {item.subject}
                </p>
                <span className="text-[11px] shrink-0 rounded-full px-1.5 py-px" style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>
                  {item.messages.length} msgs
                </span>
              </div>
              <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--muted-foreground)' }}>
                {formatDateTime(last.occurred_at)}
              </span>
            </div>
            <div className="space-y-1.5 pl-5">
              {[...item.messages].reverse().map((m) => (
                <InteractionRow
                  key={m.id}
                  i={m}
                  compact
                  expanded={expanded[m.id] ?? false}
                  summary={summaries[m.id]}
                  summarizing={summarizing[m.id] ?? false}
                  onToggleExpand={() => setExpanded((e) => ({ ...e, [m.id]: !e[m.id] }))}
                  onSummarize={allowSummarize ? () => summarizeEmail(m.id, m.content, m.subject) : null}
                  onReply={onReply}
                  onDelete={allowDelete ? () => deleteInteraction(m.id) : null}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────

function InteractionRow({
  i, expanded, summary, summarizing, compact = false,
  onToggleExpand, onSummarize, onReply, onDelete,
}: {
  i: Interaction
  expanded: boolean
  summary?: string
  summarizing: boolean
  compact?: boolean
  onToggleExpand: () => void
  onSummarize: (() => void) | null
  onReply: ((i: Interaction) => void) | null
  onDelete: (() => void) | null
}) {
  const isEmail   = i.type === 'email'
  const isInbound = i.direction === 'inbound'
  const html      = (i.metadata as Record<string, unknown> | null)?.html as string | undefined
  const text      = i.content ?? ''
  const long      = text.length > 280

  return (
    <div className={compact ? 'rounded-md p-2.5' : 'rounded-xl p-4'} style={{ background: compact ? 'transparent' : 'var(--card)', boxShadow: compact ? 'none' : 'var(--shadow-card)', border: compact ? '1px solid var(--border)' : undefined }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isEmail
            ? (isInbound
                ? <ArrowDownLeft className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--interaction-email)' }} />
                : <ArrowUpRight  className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--status-active)' }} />)
            : <Circle className="h-3 w-3 shrink-0" style={{ color: 'var(--muted-foreground)' }} />
          }
          <p className="text-[12.5px] font-medium truncate" style={{ color: 'var(--foreground)' }}>
            {i.subject ?? (i.type === 'note' ? 'Nota' : i.type)}
          </p>
          <span className="text-[10.5px] shrink-0 rounded px-1 py-px uppercase tracking-wide" style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>
            {i.type}
          </span>
        </div>
        <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--muted-foreground)' }}>
          {formatDateTime(i.occurred_at)}
        </span>
      </div>

      {summary && (
        <div className="mt-2 rounded-md p-2 text-[12px]" style={{ background: 'rgba(91,91,214,0.06)', color: 'var(--foreground)', border: '1px solid rgba(91,91,214,0.2)' }}>
          <p className="text-[10.5px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--primary)' }}>Resumo IA</p>
          {summary}
        </div>
      )}

      {text && (
        <div className="mt-2 text-[12.5px]" style={{ color: 'var(--foreground)' }}>
          {expanded
            ? (html
                ? <EmailHtmlViewer html={html} className="max-h-[420px] overflow-auto" />
                : <pre className="whitespace-pre-wrap font-mono text-[12px] rounded p-2 max-h-96 overflow-auto" style={{ background: 'var(--muted)' }}>{stripHtml(text)}</pre>)
            : <p className="line-clamp-3" style={{ color: 'var(--muted-foreground)' }}>{stripHtml(text).slice(0, 280)}{long ? '…' : ''}</p>
          }
        </div>
      )}

      <div className="mt-2 flex items-center gap-1">
        {text && long && (
          <button onClick={onToggleExpand} className="text-[11px] flex items-center gap-1 rounded px-2 py-1 hover:bg-[var(--border)]" style={{ color: 'var(--muted-foreground)' }}>
            {expanded ? <><ChevronUp className="h-3 w-3" /> Recolher</> : <><ChevronDown className="h-3 w-3" /> Expandir</>}
          </button>
        )}
        {isEmail && onSummarize && (
          <button onClick={onSummarize} disabled={summarizing} className="text-[11px] flex items-center gap-1 rounded px-2 py-1 hover:bg-[var(--border)] disabled:opacity-50" style={{ color: 'var(--primary)' }}>
            {summarizing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Resumir
          </button>
        )}
        {isEmail && isInbound && onReply && (
          <button onClick={() => onReply(i)} className="text-[11px] flex items-center gap-1 rounded px-2 py-1 hover:bg-[var(--border)]" style={{ color: 'var(--foreground)' }}>
            <Reply className="h-3 w-3" /> Responder
          </button>
        )}
        <div className="flex-1" />
        {onDelete && (
          <button onClick={onDelete} className="text-[11px] flex items-center gap-1 rounded px-2 py-1 hover:bg-[var(--border)]" style={{ color: '#C0272B' }}>
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}
