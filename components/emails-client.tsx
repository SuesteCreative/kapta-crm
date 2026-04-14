'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mail, ArrowDownLeft, ArrowUpRight, Search, RefreshCw, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { formatDateTime } from '@/lib/utils'
import { toast } from 'sonner'

interface EmailRow {
  id: string
  customer_id: string
  direction: string | null
  subject: string | null
  content: string | null
  occurred_at: string
  metadata: Record<string, unknown> | null
  customers: {
    id: string
    name: string
    company: string | null
  } | null
}

const DIRECTION_FILTERS = [
  { key: null,       label: 'Todos' },
  { key: 'inbound',  label: 'Recebidos' },
  { key: 'outbound', label: 'Enviados' },
]

export function EmailsClient({ emails }: { emails: EmailRow[] }) {
  const router = useRouter()
  const [search, setSearch]           = useState('')
  const [dirFilter, setDirFilter]     = useState<string | null>(null)
  const [syncing, setSyncing]         = useState(false)

  // Auto-sync removed — sidebar handles global auto-sync to avoid concurrent requests

  async function syncNow(silent = false) {
    setSyncing(true)
    try {
      const res  = await fetch('/api/imap/sync')
      const text = await res.text()
      let data: Record<string, unknown>
      try { data = JSON.parse(text) } catch { throw new Error(`Resposta inválida (HTTP ${res.status}): ${text.slice(0, 200)}`) }
      localStorage.setItem('lastEmailSync', String(Date.now()))
      if (data.ok) {
        if ((data.synced as number) > 0) {
          if (!silent) toast.success(`${data.synced} email(s) importados · ${data.created_leads ?? 0} novos leads`, { duration: Infinity })
          router.refresh()
        } else {
          if (!silent) toast.success('Sem novos emails', { duration: Infinity })
        }
      } else {
        if (!silent) toast.error('Erro ao sincronizar', { description: data.error as string, duration: Infinity })
      }
    } catch (e) {
      if (!silent) toast.error('Erro ao sincronizar', { description: String(e), duration: Infinity })
    } finally {
      setSyncing(false)
    }
  }

  const filtered = emails.filter((e) => {
    const q = search.toLowerCase()
    const matchesSearch =
      !search ||
      (e.subject ?? '').toLowerCase().includes(q) ||
      (e.customers?.name ?? '').toLowerCase().includes(q) ||
      (e.customers?.company ?? '').toLowerCase().includes(q) ||
      (e.content ?? '').toLowerCase().includes(q)
    const matchesDir = !dirFilter || e.direction === dirFilter
    return matchesSearch && matchesDir
  })

  return (
    <div className="p-7 max-w-[900px] mx-auto space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--foreground)' }}>
            Emails
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
            {emails.length} emails sincronizados
          </p>
        </div>
        <button
          onClick={() => syncNow()}
          disabled={syncing}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-opacity hover:opacity-70 disabled:opacity-40"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            color: 'var(--muted-foreground)',
          }}
        >
          {syncing
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <RefreshCw className="h-3.5 w-3.5" />}
          {syncing ? 'A sincronizar…' : 'Sincronizar'}
        </button>
      </div>

      {/* Filters */}
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
            placeholder="Pesquisar assunto, cliente…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-1.5">
          {DIRECTION_FILTERS.map(({ key, label }) => (
            <button
              key={String(key)}
              onClick={() => setDirFilter(key)}
              className="rounded-full px-3 py-1 text-[12px] font-medium transition-all"
              style={{
                background: dirFilter === key ? 'var(--foreground)' : 'var(--card)',
                color: dirFilter === key ? 'var(--card)' : 'var(--muted-foreground)',
                border: `1px solid ${dirFilter === key ? 'var(--foreground)' : 'var(--border)'}`,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Feed */}
      <div
        className="rounded-xl overflow-hidden divide-y"
        style={{
          background: 'var(--card)',
          boxShadow: 'var(--shadow-card)',
          border: '1px solid var(--border)',
        }}
      >
        {filtered.length === 0 && (
          <div className="px-5 py-12 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>
            {emails.length === 0 ? 'Nenhum email sincronizado. Clica em Sincronizar.' : 'Nenhum resultado.'}
          </div>
        )}

        {filtered.map((email) => {
          const isInbound = email.direction === 'inbound'
          const cc  = email.metadata?.cc  as string | null | undefined
          const bcc = email.metadata?.bcc as string | null | undefined

          return (
            <div
              key={email.id}
              className="flex gap-4 px-5 py-4 cursor-pointer row-hover"
              style={{ borderBottom: '1px solid var(--border)' }}
              onClick={() => router.push(`/customers/${email.customer_id}`)}
            >
              {/* Direction icon */}
              <div
                className="mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                style={{
                  background: isInbound ? 'rgba(59,130,246,0.1)' : 'rgba(45,185,117,0.1)',
                }}
              >
                {isInbound
                  ? <ArrowDownLeft className="h-3.5 w-3.5" style={{ color: 'var(--interaction-email)' }} />
                  : <ArrowUpRight  className="h-3.5 w-3.5" style={{ color: 'var(--status-active)' }} />}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="font-medium text-[13.5px] truncate" style={{ color: 'var(--foreground)' }}>
                      {email.customers?.name ?? '—'}
                    </span>
                    {email.customers?.company && (
                      <span className="text-[12px] truncate shrink-0" style={{ color: 'var(--muted-foreground)' }}>
                        {email.customers.company}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] shrink-0 tabular-nums" style={{ color: 'var(--muted-foreground)' }}>
                    {formatDateTime(email.occurred_at)}
                  </span>
                </div>

                <p className="text-[13px] font-medium mt-0.5 truncate" style={{ color: 'var(--foreground)' }}>
                  {email.subject ?? '(sem assunto)'}
                </p>

                {email.content && (
                  <p className="text-[12px] mt-0.5 line-clamp-2" style={{ color: 'var(--muted-foreground)' }}>
                    {email.content.replace(/\n/g, ' ').slice(0, 300)}
                  </p>
                )}

                {(cc || bcc) && (
                  <div className="flex gap-3 mt-1">
                    {cc  && <span className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>CC: {cc}</span>}
                    {bcc && <span className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>BCC: {bcc}</span>}
                  </div>
                )}
              </div>

              {/* Direction label */}
              <div className="shrink-0 self-center">
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    background: isInbound ? 'rgba(59,130,246,0.08)' : 'rgba(45,185,117,0.08)',
                    color: isInbound ? 'var(--interaction-email)' : 'var(--status-active)',
                  }}
                >
                  <Mail className="h-2.5 w-2.5" />
                  {isInbound ? 'Recebido' : 'Enviado'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
