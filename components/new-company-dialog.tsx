'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

interface Props { open: boolean; onClose: () => void }

export function NewCompanyDialog({ open, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ name: '', domain: '', industry: '', website: '', notes: '' })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setLoading(true)
    try {
      const { error } = await supabase.from('companies').insert({
        name: form.name.trim(),
        domain: form.domain.trim() || null,
        industry: form.industry.trim() || null,
        website: form.website.trim() || null,
        notes: form.notes.trim() || null,
      })
      if (error) throw error
      toast.success('Empresa criada!')
      setForm({ name: '', domain: '', industry: '', website: '', notes: '' })
      onClose()
    } catch { toast.error('Erro ao criar empresa.') }
    finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--foreground)' }}>Nova empresa</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Meet-Frank" required />
            </div>
            <div className="space-y-1.5">
              <Label>Domínio</Label>
              <Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="meet-frank.com" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Indústria</Label>
              <Input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} placeholder="SaaS, Fintech…" />
            </div>
            <div className="space-y-1.5">
              <Label>Website</Label>
              <Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://…" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notas</Label>
            <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notas sobre a empresa…" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={loading} style={{ background: 'var(--primary)', color: '#fff' }}>
              {loading ? 'A criar…' : 'Criar empresa'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
