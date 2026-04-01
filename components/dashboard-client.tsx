'use client'

import Link from 'next/link'
import {
  AlertTriangle, Clock, Users, Ticket,
  Mail, MessageSquare, Video, Phone, FileText, ArrowUpRight,
} from 'lucide-react'
import { dueDateLabel, STATUS_STYLES, STATUS_LABELS, PRIORITY_STYLES, timeAgo } from '@/lib/utils'
import type { FollowUp, Interaction, Customer } from '@/lib/database.types'

type FollowUpWithCustomer = FollowUp & { customers: { name: string; company: string | null } | null }
type InteractionWithCustomer = Interaction & { customers: { name: string; company: string | null } | null }

interface DashboardData {
  overdue: FollowUpWithCustomer[]
  today: FollowUpWithCustomer[]
  customers: Pick<Customer, 'id' | 'status'>[]
  openTickets: number
  recent: InteractionWithCustomer[]
}

const INTERACTION_ICONS: Record<string, React.ElementType> = {
  email: Mail, whatsapp: MessageSquare, meeting: Video, call: Phone, note: FileText,
}
const INTERACTION_CHANNEL_COLORS: Record<string, string> = {
  email: '#3B82F6', whatsapp: '#2DB975', meeting: '#8B5CF6', call: '#F97316', note: '#9CA3AF',
}

function statusCount(customers: Pick<Customer, 'id' | 'status'>[], status: string) {
  return customers.filter((c) => c.status === status).length
}

const KPI_CONFIG = [
  { key: 'overdue', label: 'Atrasados',     icon: AlertTriangle, color: '#E5484D', bg: 'rgba(229,72,77,0.10)',   borderColor: '#E5484D', href: '/follow-ups?filter=overdue' },
  { key: 'today',   label: 'Para hoje',      icon: Clock,         color: '#F59E0B', bg: 'rgba(245,158,11,0.10)',  borderColor: '#F59E0B', href: '/follow-ups?filter=today'   },
  { key: 'active',  label: 'Clientes ativos',icon: Users,         color: '#2DB975', bg: 'rgba(45,185,117,0.10)', borderColor: '#2DB975', href: '/customers?status=active'   },
  { key: 'tickets', label: 'Tickets abertos',icon: Ticket,        color: '#5B5BD6', bg: 'rgba(91,91,214,0.10)',  borderColor: '#5B5BD6', href: '/tickets'                   },
]

// Left-border color by priority for follow-up rows
const PRIORITY_BORDER: Record<string, string> = {
  urgent: '#E5484D',
  high:   '#F97316',
  medium: '#3B82F6',
  low:    '#A0AEC0',
}

// Section header label style (reused)
const sectionLabel: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--muted-foreground)',
}

export function DashboardClient({ data }: { data: DashboardData }) {
  const { overdue, today, customers, openTickets, recent } = data

  const kpiValues: Record<string, number> = {
    overdue: overdue.length,
    today:   today.length,
    active:  statusCount(customers, 'active'),
    tickets: openTickets,
  }

  const allPending = [...overdue, ...today].slice(0, 7)

  return (
    <div
      style={{
        padding: '2rem 2.25rem',
        maxWidth: 1140,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '2rem',
        animation: 'fadeIn 220ms ease forwards',
        fontFamily: 'var(--font-outfit), Outfit, sans-serif',
      }}
    >

      {/* ── Header ── */}
      <div>
        <h1
          style={{
            fontSize: '1.375rem',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'var(--foreground)',
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          Bom dia, Pedro 👋
        </h1>
        <p
          style={{
            fontSize: '0.875rem',
            color: 'var(--muted-foreground)',
            margin: '0.35rem 0 0',
          }}
        >
          Aqui está um resumo do teu dia.
        </p>
      </div>

      {/* ── KPI Cards ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '1rem',
        }}
      >
        {KPI_CONFIG.map(({ key, label, icon: Icon, color, bg, borderColor, href }, i) => (
          <Link
            key={key}
            href={href}
            className={`card-hover stagger-${i + 1} animate-fade-in`}
            style={{
              display: 'block',
              background: 'var(--card)',
              boxShadow: 'var(--shadow-card)',
              borderRadius: 14,
              padding: '1.25rem 1.375rem 1.375rem',
              textDecoration: 'none',
              borderTop: `3px solid ${borderColor}`,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Icon bubble */}
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '1rem',
              }}
            >
              <Icon style={{ width: 17, height: 17, color, strokeWidth: 2.2 }} />
            </div>

            {/* Number */}
            <p
              className="tabular"
              style={{
                fontSize: '2.5rem',
                fontWeight: 700,
                lineHeight: 1,
                color,
                margin: 0,
                letterSpacing: '-0.03em',
              }}
            >
              {kpiValues[key]}
            </p>

            {/* Label */}
            <p
              style={{
                fontSize: '0.75rem',
                fontWeight: 500,
                color: 'var(--muted-foreground)',
                margin: '0.5rem 0 0',
              }}
            >
              {label}
            </p>

            {/* Arrow hint top-right */}
            <ArrowUpRight
              style={{
                position: 'absolute',
                top: '1rem',
                right: '1rem',
                width: 15,
                height: 15,
                color: 'var(--muted-foreground)',
                opacity: 0.35,
              }}
            />
          </Link>
        ))}
      </div>

      {/* ── Status pills row ── */}
      <div>
        <p style={{ ...sectionLabel, marginBottom: '0.625rem' }}>Estado dos clientes</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {(['onboarding', 'at-risk', 'troubleshooting', 'churned'] as const).map((s) => {
            const style = STATUS_STYLES[s]
            const count = statusCount(customers, s)
            return (
              <Link
                key={s}
                href={`/customers?status=${s}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  borderRadius: 999,
                  padding: '0.4375rem 0.875rem',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  background: style.bg,
                  color: style.text,
                  textDecoration: 'none',
                  transition: 'opacity 150ms',
                  border: `1px solid ${style.dot}30`,
                }}
              >
                <span className="status-dot" style={{ background: style.dot }} />
                {STATUS_LABELS[s]}
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 22,
                    height: 22,
                    borderRadius: 999,
                    background: style.dot,
                    color: '#fff',
                    fontSize: '0.6875rem',
                    fontWeight: 700,
                    lineHeight: 1,
                  }}
                >
                  {count}
                </span>
              </Link>
            )
          })}
        </div>
      </div>

      {/* ── Main two-column grid ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '3fr 2fr',
          gap: '1.25rem',
          alignItems: 'start',
        }}
      >

        {/* Follow-ups pending */}
        <div
          style={{
            background: 'var(--card)',
            boxShadow: 'var(--shadow-card)',
            borderRadius: 14,
            overflow: 'hidden',
          }}
        >
          {/* Card header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '1rem 1.25rem',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div>
              <p style={sectionLabel}>Follow-ups</p>
              <p
                style={{
                  fontSize: '0.9375rem',
                  fontWeight: 700,
                  color: 'var(--foreground)',
                  margin: '0.15rem 0 0',
                  letterSpacing: '-0.01em',
                }}
              >
                Pendentes
              </p>
            </div>
            <Link
              href="/follow-ups"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: 'var(--primary)',
                textDecoration: 'none',
                opacity: 0.9,
              }}
            >
              Ver todos
              <ArrowUpRight style={{ width: 13, height: 13 }} />
            </Link>
          </div>

          {allPending.length === 0 ? (
            <div
              style={{
                padding: '3rem 1.25rem',
                textAlign: 'center',
                color: 'var(--muted-foreground)',
                fontSize: '0.875rem',
              }}
            >
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
                  <Link
                    key={f.id}
                    href={`/customers/${f.customer_id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '1rem',
                      padding: '0.875rem 1.25rem 0.875rem 1rem',
                      borderBottom: idx < allPending.length - 1 ? '1px solid var(--border)' : 'none',
                      borderLeft: `3px solid ${leftBorderColor}`,
                      textDecoration: 'none',
                      transition: 'background 120ms',
                      background: 'transparent',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--muted)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p
                        style={{
                          fontSize: '0.875rem',
                          fontWeight: 600,
                          color: 'var(--foreground)',
                          margin: 0,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {f.title}
                      </p>
                      <p
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--muted-foreground)',
                          margin: '0.2rem 0 0',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          fontWeight: 500,
                        }}
                      >
                        {f.customers?.name}
                        {f.customers?.company
                          ? <span style={{ opacity: 0.65 }}> · {f.customers.company}</span>
                          : null}
                      </p>
                    </div>

                    {/* Priority pill */}
                    <span
                      style={{
                        borderRadius: 999,
                        padding: '0.2rem 0.6rem',
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                        background: priorityStyle.bg,
                        color: priorityStyle.text,
                        whiteSpace: 'nowrap',
                        textTransform: 'capitalize',
                        letterSpacing: '0.02em',
                      }}
                    >
                      {f.priority}
                    </span>

                    {/* Due date */}
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: isOverdue ? 'var(--status-churned)' : color,
                        whiteSpace: 'nowrap',
                        minWidth: 52,
                        textAlign: 'right',
                      }}
                    >
                      {label}
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Recent activity */}
        <div
          style={{
            background: 'var(--card)',
            boxShadow: 'var(--shadow-card)',
            borderRadius: 14,
            overflow: 'hidden',
          }}
        >
          {/* Card header */}
          <div
            style={{
              padding: '1rem 1.25rem',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <p style={sectionLabel}>Interações</p>
            <p
              style={{
                fontSize: '0.9375rem',
                fontWeight: 700,
                color: 'var(--foreground)',
                margin: '0.15rem 0 0',
                letterSpacing: '-0.01em',
              }}
            >
              Atividade recente
            </p>
          </div>

          {recent.length === 0 ? (
            <div
              style={{
                padding: '3rem 1.25rem',
                textAlign: 'center',
                color: 'var(--muted-foreground)',
                fontSize: '0.875rem',
              }}
            >
              Sem interações registadas.
            </div>
          ) : (
            <div>
              {recent.map((i, idx) => {
                const Icon = INTERACTION_ICONS[i.type] ?? FileText
                const iconColor = INTERACTION_CHANNEL_COLORS[i.type] ?? '#9CA3AF'
                return (
                  <Link
                    key={i.id}
                    href={`/customers/${i.customer_id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.75rem',
                      padding: '0.875rem 1.25rem',
                      borderBottom: idx < recent.length - 1 ? '1px solid var(--border)' : 'none',
                      textDecoration: 'none',
                      transition: 'background 120ms',
                      background: 'transparent',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--muted)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {/* Channel icon bubble */}
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 9,
                        background: `${iconColor}1A`,
                        border: `1px solid ${iconColor}30`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        marginTop: 1,
                      }}
                    >
                      <Icon style={{ width: 14, height: 14, color: iconColor }} />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p
                        style={{
                          fontSize: '0.875rem',
                          fontWeight: 600,
                          color: 'var(--foreground)',
                          margin: 0,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {i.customers?.name ?? 'Desconhecido'}
                      </p>
                      <p
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--muted-foreground)',
                          margin: '0.2rem 0 0',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          fontWeight: 400,
                        }}
                      >
                        {i.subject ?? i.content?.slice(0, 50) ?? i.type}
                      </p>
                    </div>

                    <span
                      style={{
                        fontSize: '0.6875rem',
                        fontWeight: 500,
                        color: 'var(--muted-foreground)',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        marginTop: 3,
                        opacity: 0.8,
                      }}
                    >
                      {timeAgo(i.occurred_at)}
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
