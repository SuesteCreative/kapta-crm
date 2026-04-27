'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  AlertTriangle, Clock, Ticket,
  Mail, ArrowUpRight, Sparkles, Loader2, X,
} from 'lucide-react'
import { dueDateLabel, STATUS_STYLES, STATUS_LABELS, PRIORITY_STYLES } from '@/lib/utils'
import type { FollowUp, Customer } from '@/lib/database.types'
import { UnlinkedMeetingsWidget } from '@/components/unlinked-meetings-widget'
import { CommitmentsWidget } from '@/components/commitments-widget'

type FollowUpWithCustomer = FollowUp & { customers: { name: string; company: string | null } | null }

type EmailAction = {
  customerId: string
  customerName: string
  company: string | null
  subject: string | null
  daysWaiting: number
  aiPriority: string | null
  aiAction: string | null
  aiSummary: string | null
  aiCategory: string | null
}

interface DashboardData {
  overdue: FollowUpWithCustomer[]
  today: FollowUpWithCustomer[]
  customers: Pick<Customer, 'id' | 'status'>[]
  openTickets: number
  emailActions: EmailAction[]
  totalNeedsReply: number
}

const KPI_CONFIG = [
  { key: 'overdue',  label: 'Atrasados',       icon: AlertTriangle, color: '#E5484D', bg: 'rgba(229,72,77,0.10)',   borderColor: '#E5484D', href: '/follow-ups?filter=overdue' },
  { key: 'today',    label: 'Para hoje',         icon: Clock,         color: '#F59E0B', bg: 'rgba(245,158,11,0.10)',  borderColor: '#F59E0B', href: '/follow-ups?filter=today'   },
  { key: 'reply',    label: 'Emails por responder', icon: Mail,       color: '#3B82F6', bg: 'rgba(59,130,246,0.10)', borderColor: '#3B82F6', href: '/follow-ups'                },
  { key: 'tickets',  label: 'Tickets abertos',   icon: Ticket,        color: '#5B5BD6', bg: 'rgba(91,91,214,0.10)',  borderColor: '#5B5BD6', href: '/tickets'                   },
]

const PRIORITY_COLORS: Record<string, { dot: string; badge: string; text: string }> = {
  urgent: { dot: '#EF4444', badge: 'rgba(239,68,68,0.12)',  text: '#EF4444' },
  high:   { dot: '#F59E0B', badge: 'rgba(245,158,11,0.12)', text: '#B45309' },
  medium: { dot: '#3B82F6', badge: 'rgba(59,130,246,0.12)', text: '#2563EB' },
  low:    { dot: '#9CA3AF', badge: 'rgba(156,163,175,0.12)',text: '#6B7280' },
}

const PRIORITY_BORDER: Record<string, string> = {
  urgent: '#E5484D', high: '#F97316', medium: '#3B82F6', low: '#A0AEC0',
}

const sectionLabel: React.CSSProperties = {
  fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em',
  textTransform: 'uppercase', color: 'var(--muted-foreground)',
}

function statusCount(customers: Pick<Customer, 'id' | 'status'>[], status: string) {
  return customers.filter((c) => c.status === status).length
}

type DigestResult = {
  headline: string
  highlights: string[]
  urgent: string[]
  note: string
}

export function DashboardClient({ data }: { data: DashboardData }) {
  const { overdue, today, customers, openTickets, emailActions, totalNeedsReply } = data
  const [digest, setDigest] = useState<DigestResult | null>(null)
  const [generatingDigest, setGeneratingDigest] = useState(false)

  async function generateDigest() {
    setGeneratingDigest(true)
    try {
      const res = await fetch('/api/ai/weekly-digest', { method: 'POST' })
      const text = await res.text()
      let json: { ok: boolean; headline?: string; highlights?: string[]; urgent?: string[]; note?: string; error?: string }
      try { json = JSON.parse(text) } catch { throw new Error('Servidor sem resposta.') }
      if (!json.ok) throw new Error(json.error ?? 'Erro')
      setDigest({ headline: json.headline ?? '', highlights: json.highlights ?? [], urgent: json.urgent ?? [], note: json.note ?? '' })
    } catch {
      // silent
    } finally {
      setGeneratingDigest(false)
    }
  }

  const kpiValues: Record<string, number> = {
    overdue: overdue.length,
    today: today.length,
    reply: totalNeedsReply,
    tickets: openTickets,
  }

  const allPending = [...overdue, ...today].slice(0, 7)

  return (
    <div style={{
      padding: '2rem 2.25rem',
      maxWidth: 1140,
      margin: '0 auto',
      display: 'flex',
      flexDirection: 'column',
      gap: '2rem',
      animation: 'fadeIn 220ms ease forwards',
      fontFamily: 'var(--font-outfit), Outfit, sans-serif',
    }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--foreground)', margin: 0, lineHeight: 1.2 }}>
            Bom dia, Pedro 👋
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted-foreground)', margin: '0.35rem 0 0' }}>
            {overdue.length > 0
              ? `Tens ${overdue.length} follow-up${overdue.length > 1 ? 's' : ''} atrasado${overdue.length > 1 ? 's' : ''} e ${totalNeedsReply} emails por responder.`
              : `${totalNeedsReply} emails por responder hoje.`}
          </p>
        </div>
        <button
          onClick={generateDigest}
          disabled={generatingDigest}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '0.4375rem 0.875rem', borderRadius: 8,
            background: 'rgba(91,91,214,0.1)', color: 'var(--primary)',
            border: '1px solid rgba(91,91,214,0.25)',
            fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer',
            opacity: generatingDigest ? 0.7 : 1, whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          {generatingDigest
            ? <><Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> A gerar…</>
            : <><Sparkles style={{ width: 13, height: 13 }} /> Resumo semanal</>}
        </button>
      </div>

      {/* Weekly digest panel */}
      {digest && (
        <div style={{
          background: 'var(--card)', borderRadius: 14, padding: '1.25rem 1.375rem',
          boxShadow: 'var(--shadow-card)', border: '1px solid rgba(91,91,214,0.2)',
          position: 'relative',
        }}>
          <button
            onClick={() => setDigest(null)}
            style={{ position: 'absolute', top: '0.875rem', right: '0.875rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', opacity: 0.6 }}
          >
            <X style={{ width: 15, height: 15 }} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.625rem' }}>
            <Sparkles style={{ width: 14, height: 14, color: 'var(--primary)' }} />
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--primary)' }}>
              Resumo semanal · IA
            </span>
          </div>
          <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--foreground)', margin: '0 0 0.875rem' }}>
            {digest.headline}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: digest.urgent.length > 0 ? '1fr 1fr' : '1fr', gap: '1rem' }}>
            <div>
              <p style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted-foreground)', marginBottom: '0.4rem' }}>
                Destaques
              </p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                {digest.highlights.map((h, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.8125rem', color: 'var(--foreground)' }}>
                    <span style={{ marginTop: 5, width: 5, height: 5, borderRadius: '50%', background: 'var(--primary)', flexShrink: 0 }} />
                    {h}
                  </li>
                ))}
              </ul>
            </div>
            {digest.urgent.length > 0 && (
              <div>
                <p style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#EF4444', marginBottom: '0.4rem' }}>
                  Urgente
                </p>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  {digest.urgent.map((u, i) => (
                    <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.8125rem', color: 'var(--foreground)' }}>
                      <span style={{ marginTop: 5, width: 5, height: 5, borderRadius: '50%', background: '#EF4444', flexShrink: 0 }} />
                      {u}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {digest.note && (
            <p style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--muted-foreground)', fontStyle: 'italic', borderTop: '1px solid var(--border)', paddingTop: '0.625rem' }}>
              {digest.note}
            </p>
          )}
        </div>
      )}

      {/* Unlinked meetings — only renders when there are pending */}
      <UnlinkedMeetingsWidget />

      {/* Commitments to confirm */}
      <CommitmentsWidget />

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
        {KPI_CONFIG.map(({ key, label, icon: Icon, color, bg, borderColor, href }, i) => (
          <Link key={key} href={href}
            className={`card-hover stagger-${i + 1} animate-fade-in`}
            style={{
              display: 'block', background: 'var(--card)', boxShadow: 'var(--shadow-card)',
              borderRadius: 14, padding: '1.25rem 1.375rem 1.375rem', textDecoration: 'none',
              borderTop: `3px solid ${borderColor}`, position: 'relative', overflow: 'hidden',
            }}
          >
            <div style={{ width: 36, height: 36, borderRadius: 10, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
              <Icon style={{ width: 17, height: 17, color, strokeWidth: 2.2 }} />
            </div>
            <p className="tabular" style={{ fontSize: '2.5rem', fontWeight: 700, lineHeight: 1, color, margin: 0, letterSpacing: '-0.03em' }}>
              {kpiValues[key]}
            </p>
            <p style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--muted-foreground)', margin: '0.5rem 0 0' }}>
              {label}
            </p>
            <ArrowUpRight style={{ position: 'absolute', top: '1rem', right: '1rem', width: 15, height: 15, color: 'var(--muted-foreground)', opacity: 0.35 }} />
          </Link>
        ))}
      </div>

      {/* Status pills */}
      <div>
        <p style={{ ...sectionLabel, marginBottom: '0.625rem' }}>Estado dos clientes</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {(['onboarding', 'at-risk', 'troubleshooting', 'churned'] as const).map((s) => {
            const style = STATUS_STYLES[s]
            const count = statusCount(customers, s)
            return (
              <Link key={s} href={`/customers?status=${s}`} style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999,
                padding: '0.4375rem 0.875rem', fontSize: '0.8125rem', fontWeight: 600,
                background: style.bg, color: style.text, textDecoration: 'none',
                transition: 'opacity 150ms', border: `1px solid ${style.dot}30`,
              }}>
                <span className="status-dot" style={{ background: style.dot }} />
                {STATUS_LABELS[s]}
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 22, height: 22, borderRadius: 999, background: style.dot, color: 'var(--primary-foreground)', fontSize: '0.6875rem', fontWeight: 700, lineHeight: 1 }}>
                  {count}
                </span>
              </Link>
            )
          })}
        </div>
      </div>

      {/* Main two-column grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))', gap: '1.25rem', alignItems: 'start' }}>

        {/* Left: Follow-ups */}
        <div style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
            <div>
              <p style={sectionLabel}>Follow-ups</p>
              <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--foreground)', margin: '0.15rem 0 0', letterSpacing: '-0.01em' }}>
                Pendentes
              </p>
            </div>
            <Link href="/follow-ups" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8125rem', fontWeight: 600, color: 'var(--primary)', textDecoration: 'none', opacity: 0.9 }}>
              Ver todos <ArrowUpRight style={{ width: 13, height: 13 }} />
            </Link>
          </div>

          {allPending.length === 0 ? (
            <div style={{ padding: '3rem 1.25rem', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: '0.875rem' }}>
              Sem follow-ups pendentes. 🎉
            </div>
          ) : (
            <div>
              {allPending.map((f, idx) => {
                const { label, color } = dueDateLabel(f.due_date)
                const isOverdue = overdue.some((o) => o.id === f.id)
                const priorityStyle = PRIORITY_STYLES[f.priority]
                const leftBorderColor = PRIORITY_BORDER[f.priority] ?? '#A0AEC0'
                return (
                  <Link key={f.id} href={`/customers/${f.customer_id}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '1rem',
                      padding: '0.875rem 1.25rem 0.875rem 1rem',
                      borderBottom: idx < allPending.length - 1 ? '1px solid var(--border)' : 'none',
                      borderLeft: `3px solid ${leftBorderColor}`, textDecoration: 'none',
                      transition: 'background 120ms', background: 'transparent',
                    }}
                    className="row-hover"
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--foreground)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {f.title}
                      </p>
                      <p style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', margin: '0.2rem 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 }}>
                        {f.customers?.name}
                        {f.customers?.company ? <span style={{ opacity: 0.65 }}> · {f.customers.company}</span> : null}
                      </p>
                    </div>
                    <span style={{ borderRadius: 999, padding: '0.2rem 0.6rem', fontSize: '0.6875rem', fontWeight: 700, background: priorityStyle.bg, color: priorityStyle.text, whiteSpace: 'nowrap', textTransform: 'capitalize', letterSpacing: '0.02em' }}>
                      {f.priority}
                    </span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: isOverdue ? 'var(--status-churned)' : color, whiteSpace: 'nowrap', minWidth: 52, textAlign: 'right' }}>
                      {label}
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Right: Emails a responder */}
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
                    {/* Priority dot */}
                    <div style={{ marginTop: 5, width: 8, height: 8, borderRadius: '50%', background: prio?.dot ?? 'var(--muted-foreground)', flexShrink: 0 }} />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Name + company */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--foreground)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {e.customerName}
                        </p>
                        {e.company && (
                          <span style={{ fontSize: '0.7125rem', color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>· {e.company}</span>
                        )}
                      </div>

                      {/* AI action — this is the "what to do" */}
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

                      {/* AI summary (secondary) */}
                      {e.aiSummary && (
                        <p style={{ fontSize: '0.6875rem', color: 'var(--muted-foreground)', margin: '0.15rem 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {e.aiSummary}
                        </p>
                      )}
                    </div>

                    {/* Days waiting + priority badge */}
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
      </div>
    </div>
  )
}
