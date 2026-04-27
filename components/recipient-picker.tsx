'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Search, User } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'

export interface Recipient {
  email: string
  customer_id?: string
  name?: string
  company?: string | null
}

interface CustomerSearchResult {
  id: string
  name: string
  company: string | null
  emails: string[]
}

interface Props {
  label: string
  value: Recipient[]
  onChange: (next: Recipient[]) => void
  placeholder?: string
  autoFocus?: boolean
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function RecipientPicker({ label, value, onChange, placeholder = 'email@exemplo.com', autoFocus }: Props) {
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState<CustomerSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [resultsOpen, setResultsOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim().length < 1) {
      setResults([])
      return
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const q = query.trim()
        const { data: customers } = await supabase
          .from('customers')
          .select('id, name, company, customer_identifiers(type, value)')
          .or(`name.ilike.%${q}%,company.ilike.%${q}%`)
          .order('name')
          .limit(8)

        const mapped: CustomerSearchResult[] = (customers ?? []).map((c) => {
          const ids = (c.customer_identifiers ?? []) as Array<{ type: string; value: string }>
          return {
            id: c.id as string,
            name: c.name as string,
            company: (c.company ?? null) as string | null,
            emails: ids.filter((i) => i.type === 'email').map((i) => i.value),
          }
        })
        setResults(mapped)
        setResultsOpen(true)
      } finally {
        setSearching(false)
      }
    }, 200)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  // close results on outside click
  useEffect(() => {
    function onClick(ev: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
        setResultsOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function addRecipient(r: Recipient) {
    if (!r.email || !EMAIL_RE.test(r.email)) return
    if (value.some((existing) => existing.email.toLowerCase() === r.email.toLowerCase())) return
    onChange([...value, r])
  }

  function addCustomer(c: CustomerSearchResult) {
    const additions: Recipient[] = c.emails.length > 0
      ? c.emails.map((email) => ({ email, customer_id: c.id, name: c.name, company: c.company }))
      : []
    if (additions.length === 0) return
    const merged = [...value]
    for (const r of additions) {
      if (!merged.some((m) => m.email.toLowerCase() === r.email.toLowerCase())) merged.push(r)
    }
    onChange(merged)
    setQuery('')
    setResultsOpen(false)
  }

  function removeAt(idx: number) {
    onChange(value.filter((_, i) => i !== idx))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ([',', ';', 'Enter', 'Tab'].includes(e.key)) {
      const raw = (e.currentTarget as HTMLInputElement).value.trim()
      // Try to add as free-typed email when it looks like one
      if (raw && EMAIL_RE.test(raw)) {
        e.preventDefault()
        addRecipient({ email: raw })
        ;(e.currentTarget as HTMLInputElement).value = ''
        setQuery('')
        return
      }
      // If the input is plain text (likely a customer search), Enter picks the first result
      if (e.key === 'Enter' && results.length > 0) {
        e.preventDefault()
        addCustomer(results[0])
      }
    }
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    const raw = e.currentTarget.value.trim()
    if (raw && EMAIL_RE.test(raw)) {
      addRecipient({ email: raw })
      e.currentTarget.value = ''
      setQuery('')
    }
  }

  return (
    <div ref={containerRef} className="space-y-1.5 relative">
      <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>{label}</Label>

      <div
        className="flex flex-wrap gap-1.5 p-2 rounded-lg min-h-[36px]"
        style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}
      >
        {value.map((r, idx) => (
          <span
            key={`${r.email}-${idx}`}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{
              background: r.customer_id ? 'rgba(91,91,214,0.15)' : 'rgba(107,114,128,0.15)',
              color: r.customer_id ? 'var(--primary)' : 'var(--foreground)',
            }}
            title={r.name ? `${r.name}${r.company ? ` · ${r.company}` : ''}` : r.email}
          >
            {r.customer_id && <User className="h-2.5 w-2.5" />}
            {r.email}
            <button onClick={() => removeAt(idx)} className="hover:opacity-70">
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        <div className="flex items-center gap-1 flex-1 min-w-[180px]">
          {query.length > 0 && <Search className="h-3 w-3" style={{ color: 'var(--muted-foreground)' }} />}
          <input
            autoFocus={autoFocus}
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: 'var(--foreground)' }}
            placeholder={value.length === 0 ? `${placeholder} ou procurar cliente…` : ''}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            onFocus={() => { if (results.length > 0) setResultsOpen(true) }}
          />
        </div>
      </div>

      {/* Search results dropdown */}
      {resultsOpen && query.trim().length > 0 && (
        <div
          className="absolute left-0 right-0 z-30 mt-1 rounded-lg overflow-hidden"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-card)',
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          {searching && (
            <div className="px-3 py-2 text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
              A procurar…
            </div>
          )}
          {!searching && results.length === 0 && EMAIL_RE.test(query.trim()) && (
            <button
              onClick={() => { addRecipient({ email: query.trim() }); setQuery(''); setResultsOpen(false) }}
              className="w-full text-left px-3 py-2 text-[12.5px] row-hover"
              style={{ color: 'var(--foreground)' }}
            >
              Adicionar <strong>{query.trim()}</strong>
            </button>
          )}
          {!searching && results.length === 0 && !EMAIL_RE.test(query.trim()) && (
            <div className="px-3 py-2 text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
              Sem clientes com esse nome. Escreve um email completo para adicionar.
            </div>
          )}
          {!searching && results.map((c) => (
            <button
              key={c.id}
              onClick={() => addCustomer(c)}
              disabled={c.emails.length === 0}
              className="w-full text-left px-3 py-2 row-hover flex flex-col gap-0.5"
              style={{
                borderBottom: '1px solid var(--border)',
                opacity: c.emails.length === 0 ? 0.5 : 1,
                cursor: c.emails.length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              <span className="text-[13px] font-medium" style={{ color: 'var(--foreground)' }}>
                {c.name}
                {c.company && (
                  <span style={{ color: 'var(--muted-foreground)', fontWeight: 400 }}> · {c.company}</span>
                )}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
                {c.emails.length === 0
                  ? 'Sem email registado'
                  : c.emails.length === 1
                    ? c.emails[0]
                    : `${c.emails.length} emails: ${c.emails.slice(0, 2).join(', ')}${c.emails.length > 2 ? '…' : ''}`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
