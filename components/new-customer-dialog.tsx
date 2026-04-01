'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

interface Props { open: boolean; onClose: () => void }

export function NewCustomerDialog({ open, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: '', company: '', plan: '', status: 'onboarding' as const,
    email: '', phone: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setLoading(true)
    try {
      const { data: customer, error } = await supabase
        .from('customers')
        .insert({ name: form.name.trim(), company: form.company || null, plan: form.plan || null, status: form.status })
        .select()
        .single()
      if (error || !customer) throw error

      const identifiers = []
      if (form.email.trim()) identifiers.push({ customer_id: customer.id, type: 'email' as const, value: form.email.trim().toLowerCase(), is_primary: true })
      if (form.phone.trim()) identifiers.push({ customer_id: customer.id, type: 'phone' as const, value: form.phone.trim(), is_primary: !form.email.trim() })
      if (identifiers.length) await supabase.from('customer_identifiers').insert(identifiers)

      toast.success('Cliente criado com sucesso!')
      setForm({ name: '', company: '', plan: '', status: 'onboarding', email: '', phone: '' })
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
              <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Nome da empresa" />
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
