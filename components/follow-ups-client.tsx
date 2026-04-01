'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, Circle, AlertTriangle, Clock, CalendarDays } from 'lucide-react'
import { cn, dueDateLabel, PRIORITY_STYLES } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { FollowUp } from '@/lib/database.types'

type FollowUpWithCustomer = FollowUp & { customers: { id: string; name: string; company: string | null } | null }

const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 }

export function FollowUpsClient({ followUps }: { followUps: FollowUpWithCustomer[] }) {
  const router = useRouter()
  const params = useSearchParams()
  const [tab, setTab] = useState(params.get('filter') ?? 'open')

  const today = new Date().toISOString().split('T')[0]
  const overdue  = followUps.filter((f) => f.status === 'open' && f.due_date && f.due_date < today)
  const todayItems = followUps.filter((f) => f.status === 'open' && f.due_date === today)
  const upcoming = followUps.filter((f) => f.status === 'open' && (!f.due_date || f.due_date > today))
  const done     = followUps.filter((f) => f.status === 'done')
  const openCount = overdue.length + todayItems.length + upcoming.length

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

  return (
    <div className="p-7 max-w-[780px] mx-auto space-y-6 animate-fade-in">

      {/* Header */}
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--foreground)' }}>
          Follow-ups
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
          {openCount} abertos · {done.length} concluídos
        </p>
      </div>

      {/* Tabs */}
      <div
        className="inline-flex rounded-lg p-1 gap-1"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        {[
          { key: 'open', label: `Abertos (${openCount})` },
          { key: 'done', label: `Concluídos (${done.length})` },
        ].map(({ key, label }) => (
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

      {/* Open */}
      {tab === 'open' && (
        <div className="space-y-6">
          {openCount === 0 && (
            <div className="rounded-xl p-8 text-center" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Sem follow-ups abertos. 🎉</p>
            </div>
          )}
          <Section items={overdue}    label="Atrasados"  icon={AlertTriangle} color="var(--status-churned)"    onToggle={toggle} />
          <Section items={todayItems} label="Para hoje"  icon={Clock}         color="#F59E0B"                   onToggle={toggle} />
          <Section items={upcoming}   label="Próximos"   icon={CalendarDays}  color="var(--muted-foreground)"  onToggle={toggle} />
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
      style={{
        background: 'var(--card)',
        boxShadow: 'var(--shadow-card)',
        opacity: done ? 0.5 : 1,
      }}
    >
      <button onClick={() => onToggle(f.id, f.status)} className="mt-0.5 shrink-0">
        {done
          ? <CheckCircle2 className="h-[18px] w-[18px]" style={{ color: '#2DB975' }} />
          : <Circle       className="h-[18px] w-[18px] transition-colors" style={{ color: 'var(--border)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#2DB975')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--border)')}
            />}
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
        {f.customers && (
          <Link
            href={`/customers/${f.customers.id}`}
            className="text-[11px] font-medium mt-1 inline-block transition-colors hover:opacity-70"
            style={{ color: 'var(--primary)' }}
          >
            {f.customers.name}{f.customers.company ? ` · ${f.customers.company}` : ''}
          </Link>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <span
          className="text-[11px] font-medium rounded-full px-2 py-0.5"
          style={{ background: ps.bg, color: ps.text }}
        >
          {f.priority}
        </span>
        <span className="text-[11px]" style={{ color }}>{label}</span>
      </div>
    </div>
  )
}
