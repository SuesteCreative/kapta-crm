'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Loader2, GitMerge, AlertTriangle, Check } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { FH_STATUS_LABELS, type FhIntegrationStatus } from '@/lib/database.types'

interface Candidate {
  id: string
  name: string
  shortname: string
  email: string
  status: FhIntegrationStatus
}

interface Props {
  open: boolean
  current: Candidate
  onClose: () => void
}

function domainOf(email: string): string {
  return email.toLowerCase().split('@')[1] ?? ''
}

export function FhMergeDialog({ open, current, onClose }: Props) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Candidate | null>(null)
  const [keepId, setKeepId] = useState<string>(current.id)
  const [merging, setMerging] = useState(false)

  const currentDomain = domainOf(current.email)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('fh_integrations')
      .select('id, name, shortname, email, status')
      .neq('id', current.id)
      .order('created_at', { ascending: false })
      .limit(500)
    setCandidates((data ?? []) as Candidate[])
    setLoading(false)
  }, [current.id])

  useEffect(() => { if (open) load() }, [open, load])

  useEffect(() => {
    if (!open) { setQuery(''); setSelected(null); setKeepId(current.id) }
  }, [open, current.id])

  // Same-domain first (most likely the duplicate), then the rest. Apply search.
  const q = query.trim().toLowerCase()
  const filtered = candidates
    .filter((c) =>
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.shortname.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q),
    )
    .sort((a, b) => {
      const ad = domainOf(a.email) === currentDomain ? 0 : 1
      const bd = domainOf(b.email) === currentDomain ? 0 : 1
      return ad - bd
    })

  async function handleMerge() {
    if (!selected) return
    const keeper = keepId === current.id ? current : selected
    const dup    = keepId === current.id ? selected : current
    setMerging(true)
    try {
      const res = await fetch(`/api/fareharbor/${dup.id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keeper_id: keeper.id }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Erro desconhecido')
      toast.success(`Unido em «${keeper.name}». «${dup.name}» apagado.`)
      onClose()
      // If we deleted the page we're on, go to the keeper; else just refresh.
      if (dup.id === current.id) router.push(`/fareharbor/${keeper.id}`)
      else router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao unir integrações.')
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
            Unir integração duplicada
          </DialogTitle>
          <DialogDescription>
            Junta esta integração com outra da mesma empresa. O histórico de emails e contactos é movido para a que ficar; a outra é apagada.
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--muted-foreground)' }} />
              {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin" style={{ color: 'var(--muted-foreground)' }} />}
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Shortname, nome, email…"
                className="pl-9 pr-9"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
              />
            </div>

            <div className="space-y-1 max-h-72 overflow-y-auto">
              {filtered.map((c) => {
                const sameDomain = domainOf(c.email) === currentDomain
                return (
                  <button
                    key={c.id}
                    onClick={() => { setSelected(c); setKeepId(current.id) }}
                    className="w-full text-left rounded-lg px-3 py-2.5 transition-opacity hover:opacity-70"
                    style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{c.name}</p>
                      <span className="text-[11px] font-mono rounded px-1.5 py-px" style={{ background: 'var(--card)', color: 'var(--muted-foreground)' }}>
                        {c.shortname}
                      </span>
                      {sameDomain && (
                        <span className="text-[10.5px] rounded-full px-2 py-px font-medium" style={{ background: 'rgba(91,91,214,0.1)', color: 'var(--primary)' }}>
                          Mesma empresa
                        </span>
                      )}
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
                      {[c.email, FH_STATUS_LABELS[c.status]].filter(Boolean).join(' · ')}
                    </p>
                  </button>
                )
              })}
              {!loading && filtered.length === 0 && (
                <p className="text-sm text-center py-4" style={{ color: 'var(--muted-foreground)' }}>
                  Nenhuma integração encontrada.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs font-medium" style={{ color: 'var(--muted-foreground)' }}>
              Qual fica? (a outra é apagada)
            </p>
            {[current, selected].map((c) => {
              const isKeep = keepId === c.id
              return (
                <button
                  key={c.id}
                  onClick={() => setKeepId(c.id)}
                  className="w-full text-left rounded-lg px-3 py-2.5 flex items-start gap-2.5 transition-colors"
                  style={{
                    background: isKeep ? 'rgba(45,185,117,0.08)' : 'var(--muted)',
                    border: `1px solid ${isKeep ? 'rgba(45,185,117,0.5)' : 'var(--border)'}`,
                  }}
                >
                  <span
                    className="mt-0.5 h-4 w-4 rounded-full flex items-center justify-center shrink-0"
                    style={{ border: `1.5px solid ${isKeep ? '#1a9e6c' : 'var(--muted-foreground)'}`, background: isKeep ? '#1a9e6c' : 'transparent' }}
                  >
                    {isKeep && <Check className="h-3 w-3 text-white" />}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{c.name}</p>
                      <span className="text-[11px] font-mono rounded px-1.5 py-px" style={{ background: 'var(--card)', color: 'var(--muted-foreground)' }}>
                        {c.shortname}
                      </span>
                      {c.id === current.id && (
                        <span className="text-[10.5px]" style={{ color: 'var(--muted-foreground)' }}>(atual)</span>
                      )}
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
                      {[c.email, FH_STATUS_LABELS[c.status]].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </button>
              )
            })}

            <div
              className="rounded-lg p-3 flex items-start gap-2"
              style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)' }}
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'rgb(220,38,38)' }} />
              <div className="text-sm" style={{ color: 'var(--foreground)' }}>
                <span className="font-medium">{keepId === current.id ? selected.name : current.name}</span> será apagado e o seu histórico movido para{' '}
                <span className="font-medium">{keepId === current.id ? current.name : selected.name}</span>. Irreversível.
              </div>
            </div>

            <button
              onClick={() => setSelected(null)}
              className="text-xs underline-offset-2 hover:underline"
              style={{ color: 'var(--muted-foreground)' }}
            >
              ← Escolher outra integração
            </button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={merging}>Cancelar</Button>
          {selected && (
            <Button
              onClick={handleMerge}
              disabled={merging}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {merging
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> A unir…</>
                : `Unir — manter «${keepId === current.id ? current.name : selected.name}»`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
