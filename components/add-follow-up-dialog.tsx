'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sparkles, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

interface InteractionContext {
  type: string
  direction: string | null
  subject: string | null
  content: string | null
  occurred_at: string
}

interface Props {
  open: boolean
  customerId: string
  customerName?: string
  customerCompany?: string | null
  interactions?: InteractionContext[]
  onClose: () => void
}

export function AddFollowUpDialog({ open, customerId, customerName, customerCompany, interactions = [], onClose }: Props) {
  const [loading,     setLoading]     = useState(false)
  const [suggesting,  setSuggesting]  = useState(false)
  const [adjustPrompt, setAdjustPrompt] = useState('')
  const [form, setForm] = useState({
    title: '', description: '', due_date: '', priority: 'medium' as 'low' | 'medium' | 'high' | 'urgent',
  })

  async function suggestWithAI() {
    if (interactions.length === 0) {
      toast.error('Sem interações para analisar.')
      return
    }
    const refining = !!adjustPrompt.trim()
    setSuggesting(true)
    try {
      const res = await fetch('/api/ai/suggest-follow-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: customerName ?? 'Cliente',
          customer_company: customerCompany ?? null,
          interactions,
          user_prompt: adjustPrompt.trim() || undefined,
          current: refining ? { title: form.title, description: form.description, priority: form.priority } : undefined,
        }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      setForm((f) => ({
        ...f,
        title: json.title ?? f.title,
        description: json.description ?? f.description,
        priority: json.priority ?? f.priority,
      }))
      toast.success(refining ? 'Ajustado — revê antes de criar.' : 'Sugestão gerada — revê antes de criar.')
    } catch {
      toast.error('Erro ao gerar sugestão.')
    } finally {
      setSuggesting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) return
    setLoading(true)
    try {
      const { error } = await supabase.from('follow_ups').insert({
        customer_id: customerId,
        title: form.title.trim(),
        description: form.description || null,
        due_date: form.due_date || null,
        priority: form.priority,
      })
      if (error) throw error
      toast.success('Follow-up criado!')
      setForm({ title: '', description: '', due_date: '', priority: 'medium' })
      onClose()
    } catch {
      toast.error('Erro ao criar follow-up.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo follow-up</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* AI suggest + adjust — only if context is available */}
          {interactions.length > 0 && (
            <div className="space-y-2">
              <Textarea
                rows={2}
                value={adjustPrompt}
                onChange={(e) => setAdjustPrompt(e.target.value)}
                placeholder="(opcional) Instrução para a IA: ex. 'foca na fatura por pagar', 'mais urgente', 'incluir prazo de 3 dias'…"
                className="text-[12.5px]"
                style={{ background: 'rgba(91,91,214,0.04)', border: '1px solid rgba(91,91,214,0.2)' }}
                disabled={suggesting}
              />
              <Button
                type="button"
                onClick={suggestWithAI}
                disabled={suggesting}
                className="w-full h-9 gap-2 rounded-lg text-[13px] font-medium"
                style={{ background: 'rgba(91,91,214,0.1)', color: 'var(--primary)', border: '1px solid rgba(91,91,214,0.25)' }}
              >
                {suggesting
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {adjustPrompt.trim() ? 'A ajustar…' : 'A gerar…'}</>
                  : <><Sparkles className="h-3.5 w-3.5" /> {adjustPrompt.trim() ? 'Ajustar com IA' : 'Gerar com IA'}</>}
              </Button>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Título *</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Ex: Verificar se resolveram o problema"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <Textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Contexto adicional…"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Data limite</Label>
              <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Prioridade</Label>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v as typeof form.priority })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Baixa</SelectItem>
                  <SelectItem value="medium">Média</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="urgent">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={loading}>{loading ? 'A criar…' : 'Criar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
