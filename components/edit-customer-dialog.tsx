'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { CustomerWithIdentifiers, Company } from '@/lib/database.types'

interface Props { open: boolean; customer: CustomerWithIdentifiers; onClose: () => void }

type RelinkPending = { email: string; count: number; sourceNames: string[] }

export function EditCustomerDialog({ open, customer, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [relinkPending, setRelinkPending] = useState<RelinkPending | null>(null)
  const [relinking, setRelinking] = useState(false)
  const [form, setForm] = useState({
    name: customer.name,
    company: customer.company ?? '',
    company_id: customer.company_id ?? '',
    plan: customer.plan ?? '',
    status: customer.status,
    health_score: customer.health_score,
    notes: customer.notes ?? '',
  })

  useEffect(() => {
    if (!open) return
    supabase.from('companies').select('id, name').order('name').then(({ data }) => setCompanies((data ?? []) as Company[]))
  }, [open])

  const [newId, setNewId] = useState({ type: 'email' as 'email' | 'phone' | 'whatsapp', value: '', is_primary: false })

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const { error } = await supabase.from('customers').update({
        name: form.name.trim(),
        company: form.company || null,
        company_id: form.company_id || null,
        plan: form.plan || null,
        status: form.status,
        health_score: form.health_score,
        notes: form.notes || null,
      }).eq('id', customer.id)
      if (error) throw error
      toast.success('Cliente atualizado!')
      onClose()
    } catch { toast.error('Erro ao atualizar.') }
    finally { setLoading(false) }
  }

  async function addIdentifier() {
    if (!newId.value.trim()) return
    const emailValue = newId.value.trim().toLowerCase()
    const { error } = await supabase.from('customer_identifiers').insert({
      customer_id: customer.id, type: newId.type, value: emailValue, is_primary: newId.is_primary,
    })
    if (error) { toast.error('Erro ao adicionar identificador.'); return }
    toast.success('Identificador adicionado!')
    setNewId({ type: 'email', value: '', is_primary: false })

    // Re-link existing interactions for email identifiers
    if (newId.type === 'email') {
      try {
        const previewRes = await fetch(`/api/customers/${customer.id}/relink-identifier`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: emailValue, preview: true }),
        })
        const preview = await previewRes.json()

        if (preview.conflict) {
          toast.warning(`Este email já está registado para "${preview.owner_name}". As interações não foram movidas.`)
          onClose()
          return
        }

        if (preview.count === 0) {
          toast.info('Sem interações anteriores para re-ligar.')
          onClose()
          return
        }

        // Show confirmation dialog — keep parent open until user decides
        setRelinkPending({ email: emailValue, count: preview.count, sourceNames: preview.source_names ?? [] })
        return // onClose() will be called by confirmRelink / cancelRelink
      } catch {
        // Re-link is best-effort — don't block on failure
      }
    }

    onClose()
  }

  async function confirmRelink() {
    if (!relinkPending) return
    setRelinking(true)
    try {
      const res = await fetch(`/api/customers/${customer.id}/relink-identifier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: relinkPending.email, confirm: true }),
      })
      const result = await res.json()
      if (result.ok) {
        toast.success(`${result.relinked} interação(ões) re-ligadas com sucesso.`)
        if (result.orphaned_customer_ids?.length > 0) {
          toast.warning('Cliente duplicado agora sem interações — pode ser eliminado.', { duration: 8000 })
        }
      } else {
        toast.error(`Erro ao re-ligar: ${result.error}`)
      }
    } catch {
      toast.error('Erro ao re-ligar interações.')
    } finally {
      setRelinking(false)
      setRelinkPending(null)
      onClose()
    }
  }

  function cancelRelink() {
    setRelinkPending(null)
    onClose()
  }

  async function removeIdentifier(id: string) {
    await supabase.from('customer_identifiers').delete().eq('id', id)
    toast.success('Removido.')
    onClose()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Editar — {customer.name}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Nome *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>Empresa</Label>
                <Select value={form.company_id || '__none__'} onValueChange={(v) => {
                  const selected = companies.find((c) => c.id === v)
                  setForm({ ...form, company_id: v === '__none__' ? '' : v, company: selected?.name ?? form.company })
                }}>
                  <SelectTrigger><SelectValue placeholder="Sem empresa" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sem empresa</SelectItem>
                    {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Plano</Label>
                <Input value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} />
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
            <div className="space-y-1.5">
              <Label>Saúde (1–5)</Label>
              <Select value={String(form.health_score)} onValueChange={(v) => setForm({ ...form, health_score: Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n} / 5</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notas internas</Label>
              <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notas sobre este cliente…" />
            </div>

            <Separator />

            {/* Identifiers */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Contactos / Identificadores</Label>
              {customer.customer_identifiers.map((i) => (
                <div key={i.id} className="flex items-center gap-2 text-sm">
                  <span className="text-slate-400 w-16 shrink-0 capitalize">{i.type}</span>
                  <span className="flex-1 font-mono text-xs text-slate-700">{i.value}</span>
                  {i.is_primary && <span className="text-xs text-blue-500">principal</span>}
                  <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400 hover:text-red-600" onClick={() => removeIdentifier(i.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <div className="flex gap-2 mt-2">
                <Select value={newId.type} onValueChange={(v) => setNewId({ ...newId, type: v as typeof newId.type })}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="phone">Telefone</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  </SelectContent>
                </Select>
                <Input className="flex-1" placeholder="valor" value={newId.value} onChange={(e) => setNewId({ ...newId, value: e.target.value })} />
                <Button type="button" variant="outline" size="sm" onClick={addIdentifier}><Plus className="h-4 w-4" /></Button>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
              <Button type="submit" disabled={loading}>{loading ? 'A guardar…' : 'Guardar alterações'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Re-link confirmation dialog — appears on top of edit dialog */}
      <Dialog open={relinkPending !== null} onOpenChange={(o) => { if (!o) cancelRelink() }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Re-ligar interações</DialogTitle>
            <DialogDescription>
              Encontradas <strong>{relinkPending?.count}</strong> interação(ões) associadas a outro cliente
              {relinkPending?.sourceNames.length ? ` (${relinkPending.sourceNames.join(', ')})` : ''}.
              Pretende movê-las para <strong>{customer.name}</strong>?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={cancelRelink} disabled={relinking}>
              Não, ignorar
            </Button>
            <Button type="button" onClick={confirmRelink} disabled={relinking}>
              {relinking ? 'A re-ligar…' : 'Sim, re-ligar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
