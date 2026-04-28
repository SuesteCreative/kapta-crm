'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { createFollowUp, type Priority } from '@/lib/quick-create'

interface Props {
  open: boolean
  customerId: string
  customerName: string
  subject: string
  onClose: () => void
}

function defaultDueDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 2)
  return d.toISOString().slice(0, 10)
}

function defaultTitle(subject: string): string {
  if (!subject) return 'Follow-up'
  const trimmed = subject.replace(/^(re|fwd?):\s*/i, '').trim()
  return trimmed.length > 80 ? `Follow-up: ${trimmed.slice(0, 77)}…` : `Follow-up: ${trimmed}`
}

export function FollowUpDialog({ open, customerId, customerName, subject, onClose }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(defaultTitle(subject))
    setDescription('')
    setDueDate(defaultDueDate())
    setPriority('medium')
  }, [open, subject])

  async function handleSave() {
    if (!title.trim()) { toast.error('Título obrigatório.'); return }
    setSaving(true)
    try {
      await createFollowUp({
        customer_id: customerId,
        title: title.trim(),
        description: description.trim() || null,
        due_date: dueDate || null,
        priority,
      })
      toast.success('Follow-up criado!')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao criar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Follow-up — {customerName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Título *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="O que precisa de acontecer…" />
          </div>

          <div className="space-y-1.5">
            <Label>Notas</Label>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Contexto opcional"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Prazo</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Prioridade</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
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
        </div>

        <DialogFooter className="gap-2 mt-4">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'A guardar…' : 'Guardar follow-up'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
