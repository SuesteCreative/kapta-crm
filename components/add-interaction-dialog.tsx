'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

interface Props { open: boolean; customerId: string; onClose: () => void }

export function AddInteractionDialog({ open, customerId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    type: 'email' as 'email' | 'whatsapp' | 'meeting' | 'call' | 'note',
    direction: 'inbound' as 'inbound' | 'outbound' | '',
    subject: '',
    content: '',
    bubbles_url: '',
    bubbles_title: '',
    occurred_at: new Date().toISOString().slice(0, 16),
  })

  const isMeeting = form.type === 'meeting'
  const isNote = form.type === 'note'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const { error } = await supabase.from('interactions').insert({
        customer_id: customerId,
        type: form.type,
        direction: (isNote || isMeeting) ? null : (form.direction || null),
        subject: form.subject || null,
        content: form.content || null,
        bubbles_url: form.bubbles_url || null,
        bubbles_title: form.bubbles_title || null,
        occurred_at: new Date(form.occurred_at).toISOString(),
      })
      if (error) throw error
      toast.success('Interação adicionada!')
      setForm({ type: 'email', direction: 'inbound', subject: '', content: '', bubbles_url: '', bubbles_title: '', occurred_at: new Date().toISOString().slice(0, 16) })
      onClose()
    } catch {
      toast.error('Erro ao adicionar interação.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova interação</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as typeof form.type })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="meeting">Reunião</SelectItem>
                  <SelectItem value="call">Chamada</SelectItem>
                  <SelectItem value="note">Nota</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!isNote && !isMeeting && (
              <div className="space-y-1.5">
                <Label>Direção</Label>
                <Select value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v as typeof form.direction })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inbound">Recebido</SelectItem>
                    <SelectItem value="outbound">Enviado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Data e hora</Label>
            <Input type="datetime-local" value={form.occurred_at} onChange={(e) => setForm({ ...form, occurred_at: e.target.value })} />
          </div>

          {!isNote && (
            <div className="space-y-1.5">
              <Label>Assunto</Label>
              <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder={isMeeting ? 'Título da reunião' : 'Assunto'} />
            </div>
          )}

          {/* Bubbles fields — only for meetings */}
          {isMeeting && (
            <>
              <div className="space-y-1.5">
                <Label>Link Bubbles (opcional)</Label>
                <Input
                  value={form.bubbles_url}
                  onChange={(e) => setForm({ ...form, bubbles_url: e.target.value })}
                  placeholder="https://app.usebubbles.com/..."
                />
              </div>
              {form.bubbles_url && (
                <div className="space-y-1.5">
                  <Label>Título da gravação</Label>
                  <Input value={form.bubbles_title} onChange={(e) => setForm({ ...form, bubbles_title: e.target.value })} placeholder="Ex: Reunião com João — Kapta" />
                </div>
              )}
            </>
          )}

          <div className="space-y-1.5">
            <Label>{isNote ? 'Nota' : 'Conteúdo / Resumo'}</Label>
            <Textarea
              rows={5}
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder={isNote ? 'Escreve a tua nota aqui…' : isMeeting ? 'Resumo ou transcrição da reunião…' : 'Conteúdo da mensagem…'}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={loading}>{loading ? 'A guardar…' : 'Guardar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
