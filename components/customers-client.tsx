'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Search, Heart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn, STATUS_STYLES, STATUS_LABELS, HEALTH_COLORS } from '@/lib/utils'
import type { CustomerWithIdentifiers } from '@/lib/database.types'
import { NewCustomerDialog } from '@/components/new-customer-dialog'

const ALL_STATUSES = ['onboarding', 'active', 'at-risk', 'troubleshooting', 'churned']

export function CustomersClient({ customers }: { customers: CustomerWithIdentifiers[] }) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const router = useRouter()

  const filtered = customers.filter((c) => {
    const matchesSearch =
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.company?.toLowerCase().includes(search.toLowerCase()) ||
      c.customer_identifiers.some((i) => i.value.toLowerCase().includes(search.toLowerCase()))
    const matchesStatus = !statusFilter || c.status === statusFilter
    return matchesSearch && matchesStatus
  })

  return (
    <div className="p-7 max-w-[1100px] mx-auto space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--foreground)' }}>
            Clientes
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
            {customers.length} clientes registados
          </p>
        </div>
        <Button
          onClick={() => setShowNew(true)}
          size="sm"
          className="gap-1.5 rounded-lg text-[13px] font-medium"
          style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          <Plus className="h-3.5 w-3.5" />
          Novo cliente
        </Button>
      </div>

      {/* Search + Status filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5"
            style={{ color: 'var(--muted-foreground)' }}
          />
          <Input
            className="pl-9 h-9 w-[280px] text-sm rounded-lg"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
            }}
            placeholder="Pesquisar nome, empresa, email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-1.5 flex-wrap">
          <FilterPill active={statusFilter === null} onClick={() => setStatusFilter(null)}>
            Todos ({customers.length})
          </FilterPill>
          {ALL_STATUSES.map((s) => {
            const count = customers.filter((c) => c.status === s).length
            const style = STATUS_STYLES[s]
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(statusFilter === s ? null : s)}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-all"
                style={{
                  background: statusFilter === s ? style.bg : 'var(--card)',
                  color: statusFilter === s ? style.text : 'var(--muted-foreground)',
                  border: `1px solid ${statusFilter === s ? style.dot + '40' : 'var(--border)'}`,
                }}
              >
                {STATUS_LABELS[s]} · {count}
              </button>
            )
          })}
        </div>
      </div>

      {/* Table */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Cliente', 'Empresa', 'Contacto', 'Estado', 'Plano', 'Saúde'].map((h) => (
                <th
                  key={h}
                  className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  Nenhum cliente encontrado.
                </td>
              </tr>
            )}
            {filtered.map((c, idx) => {
              const primary = c.customer_identifiers.find((i) => i.is_primary) ?? c.customer_identifiers[0]
              const statusStyle = STATUS_STYLES[c.status]
              return (
                <tr
                  key={c.id}
                  className="group cursor-pointer row-hover"
                  style={{
                    borderBottom: idx < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                  onClick={() => router.push(`/customers/${c.id}`)}
                >
                  <td className="px-5 py-3.5">
                    <span className="font-medium text-[13.5px]" style={{ color: 'var(--foreground)' }}>
                      {c.name}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-[13px]" style={{ color: 'var(--muted-foreground)' }}>
                    {c.company ?? '—'}
                  </td>
                  <td className="px-5 py-3.5 font-mono text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
                    {primary?.value ?? '—'}
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium"
                      style={{ background: statusStyle.bg, color: statusStyle.text }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: statusStyle.dot }}
                      />
                      {STATUS_LABELS[c.status]}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-[13px]" style={{ color: 'var(--muted-foreground)' }}>
                    {c.plan ?? '—'}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={cn('flex items-center gap-1 text-[13px] font-medium', HEALTH_COLORS[c.health_score])}>
                      <Heart className="h-3 w-3 fill-current" />
                      {c.health_score}/5
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <NewCustomerDialog open={showNew} onClose={() => { setShowNew(false); router.refresh() }} />
    </div>
  )
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full px-3 py-1 text-[12px] font-medium transition-all"
      style={{
        background: active ? 'var(--foreground)' : 'var(--card)',
        color: active ? 'var(--card)' : 'var(--muted-foreground)',
        border: `1px solid ${active ? 'var(--foreground)' : 'var(--border)'}`,
      }}
    >
      {children}
    </button>
  )
}
