'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Copy, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { CustomerWithIdentifiers } from '@/lib/database.types'

interface Props { open: boolean; customer: CustomerWithIdentifiers; onClose: () => void }

function buildTicketText(form: Record<string, string>, customer: CustomerWithIdentifiers): string {
  return `# 🎫 Ticket — ${form.title}

**Cliente:** ${customer.name}${customer.company ? ` (${customer.company})` : ''}
**Plano:** ${customer.plan ?? 'N/A'}
**Prioridade:** ${form.priority.toUpperCase()}
**Estado:** ${form.status}

---

## Descrição
${form.description || '—'}

## Passos para reproduzir
${form.steps_to_reproduce || '—'}

## Comportamento esperado
${form.expected_behavior || '—'}

## Comportamento atual
${form.actual_behavior || '—'}

${form.tags ? `## Tags\n${form.tags.split(',').map((t) => `\`${t.trim()}\``).join(' ')}` : ''}

---
*Gerado em ${new Date().toLocaleString('pt-PT')} via Kapta CRM*`
}

export function TicketBuilderDialog({ open, customer, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [form, setForm] = useState({
    title: '', description: '', steps_to_reproduce: '', expected_behavior: '',
    actual_behavior: '', priority: 'medium', status: 'open', tags: '',
  })

  const ticketText = form.title ? buildTicketText(form, customer) : ''

  async function handleSave() {
    if (!form.title.trim()) { toast.error('Título obrigatório.'); return }
    setLoading(true)
    try {
      const { error } = await supabase.from('tickets').insert({
        customer_id: customer.id,
        title: form.title.trim(),
        description: form.description || null,
        steps_to_reproduce: form.steps_to_reproduce || null,
        expected_behavior: form.expected_behavior || null,
        actual_behavior: form.actual_behavior || null,
        priority: form.priority as 'low' | 'medium' | 'high' | 'urgent',
        status: form.status as 'open' | 'in-progress' | 'resolved' | 'closed',
        tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      })
      if (error) throw error
      toast.success('Ticket guardado!')
      onClose()
    } catch {
      toast.error('Erro ao guardar ticket.')
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(ticketText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success('Ticket copiado para a área de transferência!')
  }

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value })

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ticket builder — {customer.name}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="form">
          <TabsList>
            <TabsTrigger value="form">Formulário</TabsTrigger>
            <TabsTrigger value="preview" disabled={!form.title}>Preview</TabsTrigger>
          </TabsList>

          <TabsContent value="form" className="space-y-4 mt-4">
            <div className="space-y-1.5">
              <Label>Título *</Label>
              <Input value={form.title} onChange={f('title')} placeholder="Resumo do problema" />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Textarea rows={3} value={form.description} onChange={f('description')} placeholder="Contexto do problema…" />
            </div>
            <div className="space-y-1.5">
              <Label>Passos para reproduzir</Label>
              <Textarea rows={4} value={form.steps_to_reproduce} onChange={f('steps_to_reproduce')} placeholder="1. Ir a…&#10;2. Clicar em…&#10;3. Observar…" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Comportamento esperado</Label>
                <Textarea rows={3} value={form.expected_behavior} onChange={f('expected_behavior')} placeholder="O que deveria acontecer…" />
              </div>
              <div className="space-y-1.5">
                <Label>Comportamento atual</Label>
                <Textarea rows={3} value={form.actual_behavior} onChange={f('actual_behavior')} placeholder="O que está a acontecer…" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Prioridade</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Baixa</SelectItem>
                    <SelectItem value="medium">Média</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                    <SelectItem value="urgent">Urgente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Estado</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Aberto</SelectItem>
                    <SelectItem value="in-progress">Em progresso</SelectItem>
                    <SelectItem value="resolved">Resolvido</SelectItem>
                    <SelectItem value="closed">Fechado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Tags (vírgula)</Label>
                <Input value={form.tags} onChange={f('tags')} placeholder="bug, fatura, stripe" />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="preview" className="mt-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <pre className="text-sm text-slate-700 whitespace-pre-wrap font-mono leading-relaxed">{ticketText}</pre>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          {form.title && (
            <Button type="button" variant="outline" onClick={handleCopy}>
              {copied ? <Check className="h-4 w-4 mr-1.5" /> : <Copy className="h-4 w-4 mr-1.5" />}
              {copied ? 'Copiado!' : 'Copiar ticket'}
            </Button>
          )}
          <Button onClick={handleSave} disabled={loading}>{loading ? 'A guardar…' : 'Guardar ticket'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
