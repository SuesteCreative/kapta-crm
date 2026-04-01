'use client'

import Link from 'next/link'
import { AlertTriangle, Clock, Users, Ticket, Mail, MessageSquare, Video, Phone, FileText, ArrowRight } from 'lucide-react'
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
  { key: 'overdue',  label: 'Atrasados',       icon: AlertTriangle, color: '#E5484D', bg: 'rgba(229,72,77,0.08)',   href: '/follow-ups?filter=overdue' },
  { key: 'today',    label: 'Para hoje',         icon: Clock,         color: '#F59E0B', bg: 'rgba(245,158,11,0.08)',  href: '/follow-ups?filter=today'   },
  { key: 'active',   label: 'Clientes ativos',   icon: Users,         color: '#2DB975', bg: 'rgba(45,185,117,0.08)', href: '/customers?status=active'   },
  { key: 'tickets',  label: 'Tickets abertos',   icon: Ticket,        color: '#5B5BD6', bg: 'rgba(91,91,214,0.08)',  href: '/tickets'                   },
]

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
    <div className="p-7 max-w-[1100px] mx-auto space-y-7 animate-fade-in">

      {/* Header */}
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--foreground)' }}>
          Bom dia, Pedro 👋
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
          Aqui está um resumo do teu dia.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {KPI_CONFIG.map(({ key, label, icon: Icon, color, bg, href }, i) => (
          <Link
            key={key}
            href={href}
            className={`card-hover group rounded-xl p-5 stagger-${i + 1} animate-fade-in`}
            style={{
              background: 'var(--card)',
              boxShadow: 'var(--shadow-card)',
            }}
          >
            <div className="flex items-start justify-between">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: bg }}
              >
                <Icon className="h-4 w-4" style={{ color }} strokeWidth={2} />
              </div>
              <ArrowRight
                className="h-3.5 w-3.5 opacity-0 group-hover:opacity-40 transition-opacity"
                style={{ color: 'var(--muted-foreground)' }}
              />
            </div>
            <div className="mt-4">
              <p
                className="text-3xl font-semibold tabular leading-none"
                style={{ color }}
              >
                {kpiValues[key]}
              </p>
              <p className="text-xs font-medium mt-1.5" style={{ color: 'var(--muted-foreground)' }}>
                {label}
              </p>
            </div>
          </Link>
        ))}
      </div>

      {/* Status overview pills */}
      <div className="flex flex-wrap gap-2">
        {(['onboarding', 'at-risk', 'troubleshooting', 'churned'] as const).map((s) => {
          const style = STATUS_STYLES[s]
          const count = statusCount(customers, s)
          return (
            <Link
              key={s}
              href={`/customers?status=${s}`}
              className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all hover:opacity-80"
              style={{ background: style.bg, color: style.text }}
            >
              <span
                className="status-dot"
                style={{ background: style.dot }}
              />
              {STATUS_LABELS[s]} · {count}
            </Link>
          )
        })}
      </div>

      {/* Main content: pending + activity */}
      <div className="grid lg:grid-cols-5 gap-5">

        {/* Follow-ups pending — wider column */}
        <div
          className="lg:col-span-3 rounded-xl overflow-hidden"
          style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}
        >
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
              Follow-ups pendentes
            </p>
            <Link
              href="/follow-ups"
              className="text-xs font-medium transition-colors hover:opacity-70"
              style={{ color: 'var(--primary)' }}
            >
              Ver todos →
            </Link>
          </div>

          {allPending.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                Sem follow-ups pendentes. 🎉
              </p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {allPending.map((f) => {
                const { label, color } = dueDateLabel(f.due_date)
                const isOverdue = overdue.some((o) => o.id === f.id)
                const priorityStyle = PRIORITY_STYLES[f.priority]
                return (
                  <Link
                    key={f.id}
                    href={`/customers/${f.customer_id}`}
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-[var(--muted)] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--foreground)' }}>
                        {f.title}
                      </p>
                      <p className="text-xs truncate mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
                        {f.customers?.name}{f.customers?.company ? ` · ${f.customers.company}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={{ background: priorityStyle.bg, color: priorityStyle.text }}
                      >
                        {f.priority}
                      </span>
                      <span
                        className="text-[11px] font-medium"
                        style={{ color: isOverdue ? 'var(--status-churned)' : color }}
                      >
                        {label}
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Recent activity */}
        <div
          className="lg:col-span-2 rounded-xl overflow-hidden"
          style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}
        >
          <div
            className="px-5 py-4"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
              Atividade recente
            </p>
          </div>

          {recent.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                Sem interações registadas.
              </p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {recent.map((i) => {
                const Icon = INTERACTION_ICONS[i.type] ?? FileText
                const iconColor = INTERACTION_CHANNEL_COLORS[i.type]
                return (
                  <Link
                    key={i.id}
                    href={`/customers/${i.customer_id}`}
                    className="flex items-start gap-3 px-5 py-3.5 hover:bg-[var(--muted)] transition-colors"
                  >
                    <div
                      className="mt-0.5 w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                      style={{ background: `${iconColor}18` }}
                    >
                      <Icon className="h-3.5 w-3.5" style={{ color: iconColor }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium truncate" style={{ color: 'var(--foreground)' }}>
                        {i.customers?.name ?? 'Desconhecido'}
                      </p>
                      <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
                        {i.subject ?? i.content?.slice(0, 45) ?? i.type}
                      </p>
                    </div>
                    <span className="text-[11px] shrink-0 mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
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
