'use client'

import { useState } from 'react'
import { Sparkles, Loader2, CheckCircle2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { createFollowUp, type Priority } from '@/lib/quick-create'

interface Commitment {
  customer_id: string
  customer_name: string
  customer_company: string | null
  commitment_text: string
  suggested_title: string
  suggested_priority: Priority
}

const PRIORITY_BADGE: Record<Priority, { bg: string; color: string }> = {
  urgent: { bg: 'rgba(239,68,68,0.14)', color: '#EF4444' },
  high:   { bg: 'rgba(245,158,11,0.14)', color: '#B45309' },
  medium: { bg: 'rgba(91,91,214,0.12)',  color: 'var(--primary)' },
  low:    { bg: 'rgba(107,114,128,0.12)', color: 'var(--muted-foreground)' },
}

export function CommitmentsWidget() {
  const [loading, setLoading]    = useState(false)
  const [results, setResults]    = useState<Commitment[] | null>(null)
  const [created, setCreated]    = useState<Set<number>>(new Set())
  const [scanned, setScanned]    = useState(0)

  async function detect() {
    setLoading(true)
    setCreated(new Set())
    try {
      const res = await fetch('/api/ai/detect-commitments', { method: 'POST' })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Erro')
      setResults((json.results ?? []) as Commitment[])
      setScanned(json.scanned ?? 0)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao detectar.')
    } finally {
      setLoading(false)
    }
  }

  async function createFromCommitment(idx: number, c: Commitment) {
    try {
      await createFollowUp({
        customer_id: c.customer_id,
        title: c.suggested_title,
        description: c.commitment_text,
        priority: c.suggested_priority,
      })
      toast.success('Follow-up criado')
      setCreated((prev) => new Set([...prev, idx]))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao criar.')
    }
  }

  return (
    <div
      style={{
        background: 'var(--card)',
        boxShadow: 'var(--shadow-card)',
        borderRadius: 14,
        overflow: 'hidden',
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
        <div>
          <p style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted-foreground)', margin: 0 }}>
            Compromissos
          </p>
          <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--foreground)', margin: '0.15rem 0 0', letterSpacing: '-0.01em' }}>
            Promessas por confirmar
          </p>
        </div>
        <button
          onClick={detect}
          disabled={loading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '0.4375rem 0.875rem',
            borderRadius: 8,
            background: 'rgba(91,91,214,0.1)',
            color: 'var(--primary)',
            border: '1px solid rgba(91,91,214,0.25)',
            fontSize: '0.8125rem',
            fontWeight: 600,
            cursor: 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading
            ? <><Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> A analisar…</>
            : <><Sparkles style={{ width: 13, height: 13 }} /> Detectar com IA</>}
        </button>
      </div>

      {!results ? (
        <div style={{ padding: '2rem 1.25rem', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: '0.8125rem' }}>
          Carrega no botão para encontrar promessas que fizeste em emails, reuniões e WhatsApp dos últimos 60 dias e que ainda não estão registadas como follow-up.
        </div>
      ) : results.length === 0 ? (
        <div style={{ padding: '2rem 1.25rem', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: '0.8125rem' }}>
          Tudo em dia. Analisei {scanned} interações e não encontrei compromissos por registar. 🎉
        </div>
      ) : (
        <div>
          {results.map((c, idx) => {
            const isCreated = created.has(idx)
            const badge = PRIORITY_BADGE[c.suggested_priority] ?? PRIORITY_BADGE.medium
            return (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.75rem',
                  padding: '0.875rem 1.25rem',
                  borderBottom: idx < results.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--foreground)' }}>
                      {c.customer_name}
                    </span>
                    {c.customer_company && (
                      <span style={{ fontSize: '0.6875rem', color: 'var(--muted-foreground)' }}>· {c.customer_company}</span>
                    )}
                    <span
                      style={{
                        fontSize: '0.625rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        borderRadius: 999,
                        padding: '0.1rem 0.5rem',
                        background: badge.bg,
                        color: badge.color,
                      }}
                    >
                      {c.suggested_priority}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>
                    {c.suggested_title}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', margin: '0.2rem 0 0', fontStyle: 'italic' }}>
                    “{c.commitment_text}”
                  </p>
                </div>
                <button
                  onClick={() => createFromCommitment(idx, c)}
                  disabled={isCreated}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    background: isCreated ? 'rgba(45,185,117,0.12)' : 'var(--foreground)',
                    color: isCreated ? 'var(--status-active)' : 'var(--card)',
                    border: 'none',
                    borderRadius: 6,
                    padding: '0.3rem 0.625rem',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: isCreated ? 'default' : 'pointer',
                    opacity: isCreated ? 1 : 1,
                    flexShrink: 0,
                  }}
                >
                  {isCreated
                    ? <><CheckCircle2 style={{ width: 12, height: 12 }} /> Criado</>
                    : <><Plus style={{ width: 12, height: 12 }} /> Criar follow-up</>}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
