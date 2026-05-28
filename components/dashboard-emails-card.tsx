// Server component — fetches + processes the heavy "what to reply" feed
// independently from the rest of the dashboard so it can stream in via
// <Suspense /> while the fast widgets (KPIs, follow-ups, status pills) paint
// immediately.

import Link from 'next/link'
import { ArrowUpRight, Mail, Sparkles } from 'lucide-react'
import { createServiceClient } from '@/lib/supabase'

type RawEmail = {
  id: string
  customer_id: string
  direction: string | null
  subject: string | null
  occurred_at: string
  metadata: Record<string, unknown> | null
  customers: { id: string; name: string; company: string | null } | { id: string; name: string; company: string | null }[] | null
}

const PRIO_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

const PRIORITY_COLORS: Record<string, { dot: string; badge: string; text: string }> = {
  urgent: { dot: '#EF4444', badge: 'rgba(239,68,68,0.12)',  text: '#EF4444' },
  high:   { dot: '#F59E0B', badge: 'rgba(245,158,11,0.12)', text: '#B45309' },
  medium: { dot: '#3B82F6', badge: 'rgba(59,130,246,0.12)', text: '#2563EB' },
  low:    { dot: '#9CA3AF', badge: 'rgba(156,163,175,0.12)',text: '#6B7280' },
}

const sectionLabel: React.CSSProperties = {
  fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em',
  textTransform: 'uppercase', color: 'var(--muted-foreground)',
}

async function getEmailActions() {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('interactions')
    .select('id, customer_id, direction, subject, occurred_at, metadata, customers(id, name, company)')
    .eq('type', 'email')
    .eq('direction', 'inbound')
    .order('occurred_at', { ascending: false })
    .limit(100)

  const allEmails = (data ?? []) as RawEmail[]
  const byCustomer = new Map<string, RawEmail>()
  for (const e of allEmails) {
    if (!byCustomer.has(e.customer_id)) byCustomer.set(e.customer_id, e)
  }

  const actions = []
  for (const [, e] of byCustomer) {
    const customer = Array.isArray(e.customers) ? e.customers[0] : e.customers
    const triage = e.metadata?.ai_triage as { priority: string; action: string; summary: string; category: string } | undefined
    const daysWaiting = Math.floor((Date.now() - new Date(e.occurred_at).getTime()) / 86_400_000)
    actions.push({
      customerId: e.customer_id,
      customerName: customer?.name ?? 'Desconhecido',
      company: customer?.company ?? null,
      subject: e.subject ?? null,
      daysWaiting,
      aiPriority: triage?.priority ?? null,
      aiAction: triage?.action ?? null,
      aiSummary: triage?.summary ?? null,
      aiCategory: triage?.category ?? null,
    })
  }

  actions.sort((a, b) => {
    const pa = PRIO_ORDER[a.aiPriority ?? ''] ?? 4
    const pb = PRIO_ORDER[b.aiPriority ?? ''] ?? 4
    if (pa !== pb) return pa - pb
    return b.daysWaiting - a.daysWaiting
  })

  return { emailActions: actions.slice(0, 10), totalNeedsReply: actions.length }
}

export async function DashboardEmailsCard() {
  const { emailActions, totalNeedsReply } = await getEmailActions()

  return (
    <div style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
        <div>
          <p style={sectionLabel}>Emails</p>
          <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--foreground)', margin: '0.15rem 0 0', letterSpacing: '-0.01em' }}>
            O que responder
          </p>
        </div>
        <Link href="/follow-ups" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8125rem', fontWeight: 600, color: 'var(--primary)', textDecoration: 'none', opacity: 0.9 }}>
          Ver todos <ArrowUpRight style={{ width: 13, height: 13 }} />
        </Link>
      </div>

      {emailActions.length === 0 ? (
        <div style={{ padding: '3rem 1.25rem', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: '0.875rem' }}>
          <Mail style={{ width: 28, height: 28, margin: '0 auto 0.75rem', opacity: 0.3 }} />
          Sem emails por responder.
        </div>
      ) : (
        <div>
          {emailActions.map((e, idx) => {
            const prio = e.aiPriority ? PRIORITY_COLORS[e.aiPriority] : null
            return (
              <Link key={e.customerId} href={`/customers/${e.customerId}`}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                  padding: '0.875rem 1.25rem',
                  borderBottom: idx < emailActions.length - 1 ? '1px solid var(--border)' : 'none',
                  textDecoration: 'none', transition: 'background 120ms', background: 'transparent',
                }}
                className="row-hover"
              >
                <div style={{ marginTop: 5, width: 8, height: 8, borderRadius: '50%', background: prio?.dot ?? 'var(--muted-foreground)', flexShrink: 0 }} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--foreground)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {e.customerName}
                    </p>
                    {e.company && (
                      <span style={{ fontSize: '0.7125rem', color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>· {e.company}</span>
                    )}
                  </div>

                  {e.aiAction ? (
                    <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--foreground)', margin: '0.2rem 0 0', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Sparkles style={{ width: 10, height: 10, color: 'var(--primary)', flexShrink: 0 }} />
                      {e.aiAction}
                    </p>
                  ) : e.subject ? (
                    <p style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', margin: '0.2rem 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {e.subject}
                    </p>
                  ) : null}

                  {e.aiSummary && (
                    <p style={{ fontSize: '0.6875rem', color: 'var(--muted-foreground)', margin: '0.15rem 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {e.aiSummary}
                    </p>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem', flexShrink: 0 }}>
                  {prio && (
                    <span style={{ fontSize: '0.625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', borderRadius: 999, padding: '0.15rem 0.45rem', background: prio.badge, color: prio.text }}>
                      {e.aiPriority}
                    </span>
                  )}
                  <span style={{ fontSize: '0.6875rem', color: e.daysWaiting >= 7 ? '#EF4444' : e.daysWaiting >= 3 ? '#F59E0B' : 'var(--muted-foreground)', fontWeight: 500 }}>
                    {e.daysWaiting === 0 ? 'hoje' : `${e.daysWaiting}d`}
                  </span>
                </div>
              </Link>
            )
          })}

          {totalNeedsReply > 10 && (
            <Link href="/follow-ups" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '0.75rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--primary)', textDecoration: 'none', borderTop: '1px solid var(--border)' }}>
              + {totalNeedsReply - 10} mais <ArrowUpRight style={{ width: 12, height: 12 }} />
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

export function DashboardEmailsCardSkeleton() {
  return (
    <div style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
        <div>
          <p style={sectionLabel}>Emails</p>
          <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--foreground)', margin: '0.15rem 0 0', letterSpacing: '-0.01em' }}>
            O que responder
          </p>
        </div>
      </div>
      <div style={{ padding: '0.5rem 0' }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
            padding: '0.875rem 1.25rem',
            borderBottom: i < 4 ? '1px solid var(--border)' : 'none',
            opacity: 0.6,
          }}>
            <div style={{ marginTop: 5, width: 8, height: 8, borderRadius: '50%', background: 'var(--muted)' }} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <div style={{ height: 12, width: '40%', background: 'var(--muted)', borderRadius: 4 }} />
              <div style={{ height: 10, width: '70%', background: 'var(--muted)', borderRadius: 4, opacity: 0.7 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
