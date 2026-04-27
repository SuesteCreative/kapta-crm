'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Video, Loader2, Search, ExternalLink, CheckCircle2, X } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

interface UnlinkedMeeting {
  id: string
  title: string | null
  summary: string | null
  bubbles_url: string | null
  attendees: string[] | null
  recorded_at: string
}

interface CustomerOption {
  id: string
  name: string
  company: string | null
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' })
}

function MeetingRow({ meeting, customers, onAssigned }: {
  meeting: UnlinkedMeeting
  customers: CustomerOption[]
  onAssigned: (id: string) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [assigning, setAssigning] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pickerOpen) return
    function onClick(ev: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [pickerOpen])

  const filtered = (() => {
    if (!query.trim()) return customers.slice(0, 8)
    const q = query.toLowerCase()
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || (c.company ?? '').toLowerCase().includes(q))
      .slice(0, 8)
  })()

  async function assign(customerId: string) {
    setAssigning(true)
    try {
      const res = await fetch(`/api/unlinked-meetings/${meeting.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customerId }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Erro')
      toast.success('Reunião atribuída ao cliente')
      onAssigned(meeting.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao atribuir.')
    } finally {
      setAssigning(false)
    }
  }

  const attendees = meeting.attendees ?? []
  const attendeeStr = attendees.length > 0 ? attendees.join(', ') : '(sem participantes)'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.75rem',
        padding: '0.875rem 1.25rem',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div
        style={{
          marginTop: 2,
          width: 32,
          height: 32,
          borderRadius: 8,
          background: 'rgba(91,91,214,0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Video style={{ width: 14, height: 14, color: 'var(--primary)' }} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <p
            style={{
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: 'var(--foreground)',
              margin: 0,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 280,
            }}
          >
            {meeting.title ?? '(sem título)'}
          </p>
          <span style={{ fontSize: '0.6875rem', color: 'var(--muted-foreground)' }}>
            · {formatDate(meeting.recorded_at)}
          </span>
          {meeting.bubbles_url && (
            <a
              href={meeting.bubbles_url}
              target="_blank"
              rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--muted-foreground)', opacity: 0.7 }}
              title="Abrir Bubbles"
            >
              <ExternalLink style={{ width: 11, height: 11 }} />
            </a>
          )}
        </div>
        <p
          style={{
            fontSize: '0.6875rem',
            color: 'var(--muted-foreground)',
            margin: '0.2rem 0 0',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={attendeeStr}
        >
          {attendeeStr}
        </p>
      </div>

      <div ref={containerRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          onClick={() => setPickerOpen((v) => !v)}
          disabled={assigning}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: 'var(--foreground)',
            color: 'var(--card)',
            border: 'none',
            borderRadius: 6,
            padding: '0.3rem 0.625rem',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: assigning ? 'wait' : 'pointer',
            opacity: assigning ? 0.6 : 1,
          }}
        >
          {assigning ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : null}
          Atribuir cliente
        </button>

        {pickerOpen && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              right: 0,
              width: 280,
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              boxShadow: 'var(--shadow-card)',
              zIndex: 20,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '0.5rem 0.75rem',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <Search style={{ width: 12, height: 12, color: 'var(--muted-foreground)' }} />
              <input
                autoFocus
                placeholder="Procurar cliente…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  fontSize: '0.8125rem',
                  color: 'var(--foreground)',
                }}
              />
            </div>
            <div style={{ maxHeight: 240, overflow: 'auto' }}>
              {filtered.length === 0 ? (
                <p style={{ padding: '0.75rem', fontSize: '0.75rem', color: 'var(--muted-foreground)', margin: 0, textAlign: 'center' }}>
                  Sem resultados
                </p>
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => assign(c.id)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      width: '100%',
                      padding: '0.5rem 0.75rem',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid var(--border)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                    className="row-hover"
                  >
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--foreground)' }}>{c.name}</span>
                    {c.company && (
                      <span style={{ fontSize: '0.6875rem', color: 'var(--muted-foreground)' }}>{c.company}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function UnlinkedMeetingsWidget() {
  const router = useRouter()
  const [meetings, setMeetings]   = useState<UnlinkedMeeting[]>([])
  const [customers, setCustomers] = useState<CustomerOption[]>([])
  const [loading, setLoading]     = useState(true)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [res, custRes] = await Promise.all([
          fetch('/api/unlinked-meetings'),
          supabase.from('customers').select('id, name, company').order('name'),
        ])
        const json = await res.json()
        if (cancelled) return
        if (json.ok) setMeetings(json.meetings ?? [])
        setCustomers((custRes.data ?? []) as CustomerOption[])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  function handleAssigned(id: string) {
    setMeetings((prev) => prev.filter((m) => m.id !== id))
    router.refresh()
  }

  if (dismissed) return null
  if (loading) return null
  if (meetings.length === 0) return null

  return (
    <div
      style={{
        background: 'var(--card)',
        boxShadow: 'var(--shadow-card)',
        borderRadius: 14,
        overflow: 'hidden',
        border: '1px solid rgba(245,158,11,0.25)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1rem 1.25rem',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Video style={{ width: 14, height: 14, color: '#F59E0B' }} />
          <p style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted-foreground)', margin: 0 }}>
            Reuniões por atribuir
          </p>
          <span
            style={{
              borderRadius: 999,
              padding: '0.1rem 0.5rem',
              fontSize: '0.6875rem',
              fontWeight: 700,
              background: 'rgba(245,158,11,0.15)',
              color: '#B45309',
            }}
          >
            {meetings.length}
          </span>
        </div>
        <button
          onClick={() => setDismissed(true)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', opacity: 0.5 }}
          title="Esconder até amanhã"
        >
          <X style={{ width: 14, height: 14 }} />
        </button>
      </div>
      <div>
        {meetings.map((m) => (
          <MeetingRow key={m.id} meeting={m} customers={customers} onAssigned={handleAssigned} />
        ))}
      </div>
      <div
        style={{
          padding: '0.5rem 1.25rem',
          fontSize: '0.6875rem',
          color: 'var(--muted-foreground)',
          background: 'var(--muted)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <CheckCircle2 style={{ width: 11, height: 11 }} />
        Atribui cada reunião ao cliente certo para que apareça na sua timeline.
      </div>
    </div>
  )
}
