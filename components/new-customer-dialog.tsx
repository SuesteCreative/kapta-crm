'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChevronDown, Check, X, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { Company } from '@/lib/database.types'

interface Props { open: boolean; onClose: () => void }

export function NewCustomerDialog({ open, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyQuery, setCompanyQuery] = useState('')
  const [companyOpen, setCompanyOpen] = useState(false)
  const companyPickerRef = useRef<HTMLDivElement>(null)
  const [form, setForm] = useState({
    name: '', company: '', company_id: '', plan: '', status: 'onboarding' as const,
    email: '', phone: '',
  })

  useEffect(() => {
    if (!open) return
    supabase.from('companies').select('id, name').order('name').then(({ data }) => setCompanies((data ?? []) as Company[]))
  }, [open])

  // Click-outside to close company picker
  useEffect(() => {
    if (!companyOpen) return
    function onClick(ev: MouseEvent) {
      if (companyPickerRef.current && !companyPickerRef.current.contains(ev.target as Node)) {
        setCompanyOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [companyOpen])

  const filteredCompanies = useMemo(() => {
    const q = companyQuery.trim().toLowerCase()
    if (!q) return companies
    return companies.filter((c) => c.name.toLowerCase().includes(q))
  }, [companies, companyQuery])

  const selectedCompanyName = form.company_id
    ? companies.find((c) => c.id === form.company_id)?.name ?? form.company
    : ''

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setLoading(true)
    try {
      const { data: customer, error } = await supabase
        .from('customers')
        .insert({ name: form.name.trim(), company: form.company || null, company_id: form.company_id || null, plan: form.plan || null, status: form.status })
        .select()
        .single()
      if (error || !customer) throw error

      const identifiers = []
      if (form.email.trim()) identifiers.push({ customer_id: customer.id, type: 'email' as const, value: form.email.trim().toLowerCase(), is_primary: true })
      if (form.phone.trim()) identifiers.push({ customer_id: customer.id, type: 'phone' as const, value: form.phone.trim(), is_primary: !form.email.trim() })
      if (identifiers.length) await supabase.from('customer_identifiers').insert(identifiers)

      toast.success('Cliente criado com sucesso!')
      setForm({ name: '', company: '', company_id: '', plan: '', status: 'onboarding', email: '', phone: '' })
      onClose()
    } catch {
      toast.error('Erro ao criar cliente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo cliente</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome do cliente" required />
            </div>
            <div className="space-y-1.5">
              <Label>Empresa</Label>
              <div ref={companyPickerRef} className="relative">
                <button
                  type="button"
                  onClick={() => setCompanyOpen((v) => !v)}
                  className="flex h-10 w-full items-center justify-between rounded-md border px-3 py-2 text-sm"
                  style={{ borderColor: 'var(--border)', background: 'var(--background)' }}
                >
                  <span style={{ color: selectedCompanyName ? 'var(--foreground)' : 'var(--muted-foreground)' }}>
                    {selectedCompanyName || 'Sem empresa'}
                  </span>
                  <div className="flex items-center gap-1">
                    {form.company_id && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation()
                          setForm({ ...form, company_id: '', company: '' })
                        }}
                        className="hover:opacity-70"
                        title="Limpar"
                      >
                        <X className="h-3.5 w-3.5" style={{ color: 'var(--muted-foreground)' }} />
                      </span>
                    )}
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </div>
                </button>

                {companyOpen && (
                  <div
                    className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md overflow-hidden"
                    style={{ background: 'var(--card)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}
                  >
                    <div className="relative p-2" style={{ borderBottom: '1px solid var(--border)' }}>
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: 'var(--muted-foreground)' }} />
                      <Input
                        autoFocus
                        value={companyQuery}
                        onChange={(e) => setCompanyQuery(e.target.value)}
                        placeholder="Pesquisar empresa…"
                        className="pl-8 h-8 text-[13px]"
                      />
                    </div>
                    <div className="max-h-[220px] overflow-y-auto py-1">
                      <button
                        type="button"
                        onClick={() => {
                          setForm({ ...form, company_id: '', company: '' })
                          setCompanyOpen(false)
                          setCompanyQuery('')
                        }}
                        className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-[var(--border)] flex items-center gap-2"
                        style={{ color: 'var(--muted-foreground)' }}
                      >
                        {!form.company_id && <Check className="h-3.5 w-3.5" />}
                        <span className={form.company_id ? 'pl-5' : ''}>Sem empresa</span>
                      </button>
                      {filteredCompanies.length === 0 && (
                        <div className="px-3 py-2 text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
                          Sem resultados.
                        </div>
                      )}
                      {filteredCompanies.map((c) => {
                        const isSelected = form.company_id === c.id
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setForm({ ...form, company_id: c.id, company: c.name })
                              setCompanyOpen(false)
                              setCompanyQuery('')
                            }}
                            className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-[var(--border)] flex items-center gap-2"
                            style={{ color: 'var(--foreground)' }}
                          >
                            {isSelected && <Check className="h-3.5 w-3.5" style={{ color: 'var(--primary)' }} />}
                            <span className={isSelected ? '' : 'pl-5'}>{c.name}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@exemplo.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Telefone / WhatsApp</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+351 912 345 678" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Plano</Label>
              <Input value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} placeholder="Ex: Pro, Basic…" />
            </div>
            <div className="space-y-1.5">
              <Label>Estado</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as typeof form.status })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="onboarding">Onboarding</SelectItem>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="at-risk">Em risco</SelectItem>
                  <SelectItem value="troubleshooting">Suporte</SelectItem>
                  <SelectItem value="churned">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={loading}>{loading ? 'A criar…' : 'Criar cliente'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
