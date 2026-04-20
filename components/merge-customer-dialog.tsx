'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Loader2, GitMerge, AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { CustomerWithIdentifiers } from '@/lib/database.types'

interface SearchResult {
  id: string
  name: string
  company: string | null
  customer_identifiers: { value: string; type: string }[]
}

interface Props {
  open: boolean
  customer: CustomerWithIdentifiers
  onClose: () => void
}

export function MergeCustomerDialog({ open, customer, onClose }: Props) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<SearchResult | null>(null)
  const [merging, setMerging] = useState(false)

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return }
    setSearching(true)
    const { data } = await supabase
      .from('customers')
      .select('id, name, company, customer_identifiers(value, type)')
      .ilike('name', `%${q}%`)
      .neq('id', customer.id)
      .limit(8)
    setResults((data ?? []) as SearchResult[])
    setSearching(false)
  }, [customer.id])

  useEffect(() => {
    const t = setTimeout(() => search(query), 250)
    return () => clearTimeout(t)
  }, [query, search])

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) { setQuery(''); setResults([]); setSelected(null) }
  }, [open])

  async function handleMerge() {
    if (!selected) return
    setMerging(true)
    try {
      const res = await fetch(`/api/customers/${customer.id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: selected.id }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Erro desconhecido')
      toast.success(`${selected.name} fundido com ${customer.name}.`)
      onClose()
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao fundir clientes.')
    } finally {
      setMerging(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-4 w-4" style={{ color: 'var(--primary)' }} />
            Fundir com {customer.name}
          </DialogTitle>
          <DialogDescription>
            Procura o cliente duplicado. Todas as interações, follow-ups, tickets e contactos do cliente selecionado serão movidos para {customer.name}. O cliente selecionado será eliminado.
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--muted-foreground)' }} />
              {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin" style={{ color: 'var(--muted-foreground)' }} />}
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Pesquisar por nome…"
                className="pl-9 pr-9"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
              />
            </div>

            {results.length > 0 && (
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {results.map((r) => {
                  const email = r.customer_identifiers.find((i) => i.type === 'email')?.value
                  return (
                    <button
                      key={r.id}
                      onClick={() => setSelected(r)}
                      className="w-full text-left rounded-lg px-3 py-2.5 transition-opacity hover:opacity-70"
                      style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}
                    >
                      <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{r.name}</p>
                      {(r.company || email) && (
                        <p className="text-xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
                          {[r.company, email].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </button>
                  )
                })}
              </div>
            )}

            {query.trim() && !searching && results.length === 0 && (
              <p className="text-sm text-center py-4" style={{ color: 'var(--muted-foreground)' }}>
                Nenhum cliente encontrado.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div
              className="rounded-lg p-3 flex items-start gap-2"
              style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)' }}
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'rgb(220,38,38)' }} />
              <div className="text-sm" style={{ color: 'var(--foreground)' }}>
                <span className="font-medium">{selected.name}</span> será eliminado. Todos os seus dados serão movidos para{' '}
                <span className="font-medium">{customer.name}</span>. Esta ação é irreversível.
              </div>
            </div>

            <button
              onClick={() => setSelected(null)}
              className="text-xs underline-offset-2 hover:underline"
              style={{ color: 'var(--muted-foreground)' }}
            >
              ← Escolher outro cliente
            </button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={merging}>
            Cancelar
          </Button>
          {selected && (
            <Button
              onClick={handleMerge}
              disabled={merging}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {merging ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> A fundir…</> : `Fundir e eliminar ${selected.name}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
