'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Copy, Check, Sparkles, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { CustomerWithIdentifiers, Interaction } from '@/lib/database.types'

interface Props {
  open: boolean
  customer: CustomerWithIdentifiers
  interactions?: Interaction[]
  onClose: () => void
}

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

const EMPTY_FORM = {
  title: '', description: '', steps_to_reproduce: '', expected_behavior: '',
  actual_behavior: '', priority: 'medium', status: 'open', tags: '',
}

export function TicketBuilderDialog({ open, customer, interactions = [], onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)

  // Auto-suggest when dialog opens and there are interactions
  useEffect(() => {
    if (!open) return
    setForm(EMPTY_FORM)
    if (interactions.length === 0) return

    async function suggest() {
      setSuggesting(true)
      try {
        const res = await fetch('/api/ai/suggest-ticket', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_name: customer.name,
            customer_company: customer.company ?? null,
            interactions: interactions.slice(0, 8).map((i) => ({
              type: i.type,
              direction: i.direction,
              subject: i.subject,
              content: i.content,
              occurred_at: i.occurred_at,
            })),
          }),
        })
        const text = await res.text()
        let json: { ok: boolean; title?: string; description?: string; steps_to_reproduce?: string | null; expected_behavior?: string | null; actual_behavior?: string | null; priority?: string; tags?: string[] }
        try { json = JSON.parse(text) } catch { return }
        if (!json.ok) return
        setForm({
          title: json.title ?? '',
          description: json.description ?? '',
          steps_to_reproduce: json.steps_to_reproduce ?? '',
          expected_behavior: json.expected_behavior ?? '',
          actual_behavior: json.actual_behavior ?? '',
          priority: json.priority ?? 'medium',
          status: 'open',
          tags: (json.tags ?? []).join(', '),
        })
      } finally {
        setSuggesting(false)
      }
    }

    suggest()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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
    toast.success('Ticket copiado!')
  }

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value })

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Ticket — {customer.name}
            {suggesting && (
              <span className="flex items-center gap-1.5 text-[12px] font-normal" style={{ color: 'var(--primary)' }}>
                <Loader2 className="h-3 w-3 animate-spin" /> A analisar emails…
              </span>
            )}
            {!suggesting && form.title && interactions.length > 0 && (
              <span className="flex items-center gap-1 text-[11px] font-normal rounded-full px-2 py-0.5" style={{ background: 'rgba(91,91,214,0.1)', color: 'var(--primary)' }}>
                <Sparkles className="h-2.5 w-2.5" /> Preenchido por IA
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="form">
          <TabsList>
            <TabsTrigger value="form">Formulário</TabsTrigger>
            <TabsTrigger value="preview" disabled={!form.title}>Preview</TabsTrigger>
          </TabsList>

          <TabsContent value="form" className="space-y-4 mt-4">
            <div className="space-y-1.5">
              <Label>Título *</Label>
              <Input
                value={form.title}
                onChange={f('title')}
                placeholder={suggesting ? 'A gerar…' : 'Resumo do problema'}
                disabled={suggesting}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Textarea
                rows={4}
                value={form.description}
                onChange={f('description')}
                placeholder={suggesting ? 'A gerar…' : 'Contexto do problema…'}
                disabled={suggesting}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Passos para reproduzir</Label>
              <Textarea
                rows={3}
                value={form.steps_to_reproduce}
                onChange={f('steps_to_reproduce')}
                placeholder={suggesting ? 'A gerar…' : '1. Ir a…\n2. Clicar em…\n3. Observar…'}
                disabled={suggesting}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Comportamento esperado</Label>
                <Textarea rows={3} value={form.expected_behavior} onChange={f('expected_behavior')} placeholder="O que deveria acontecer…" disabled={suggesting} />
              </div>
              <div className="space-y-1.5">
                <Label>Comportamento atual</Label>
                <Textarea rows={3} value={form.actual_behavior} onChange={f('actual_behavior')} placeholder="O que está a acontecer…" disabled={suggesting} />
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
                <Input value={form.tags} onChange={f('tags')} placeholder="bug, fatura, stripe" disabled={suggesting} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="preview" className="mt-4">
            <div className="rounded-lg border p-4" style={{ background: 'var(--muted)', borderColor: 'var(--border)' }}>
              <pre className="text-sm whitespace-pre-wrap font-mono leading-relaxed" style={{ color: 'var(--foreground)' }}>{ticketText}</pre>
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
          <Button onClick={handleSave} disabled={loading || suggesting}>
            {loading ? 'A guardar…' : 'Guardar ticket'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
