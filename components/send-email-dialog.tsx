'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import type { Template } from '@/lib/database.types'

interface Props {
  open: boolean
  customerId: string
  customerEmail: string
  customerName: string
  customerCompany?: string | null
  onClose: () => void
}

function applyTemplate(body: string, name: string, company: string | null | undefined): string {
  return body
    .replace(/\{\{name\}\}/gi, name)
    .replace(/\{\{company\}\}/gi, company ?? name)
}

export function SendEmailDialog({ open, customerId, customerEmail, customerName, customerCompany, onClose }: Props) {
  const [to,        setTo]        = useState(customerEmail)
  const [subject,   setSubject]   = useState('')
  const [body,      setBody]      = useState('')
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading,   setLoading]   = useState(false)

  // Keep "to" in sync if the customer changes
  useEffect(() => { setTo(customerEmail) }, [customerEmail])

  // Load email templates
  useEffect(() => {
    if (!open) return
    supabase
      .from('templates')
      .select('*')
      .eq('type', 'email')
      .order('name')
      .then(({ data }) => setTemplates(data ?? []))
  }, [open])

  function applyTemplateById(id: string) {
    const tpl = templates.find((t) => t.id === id)
    if (!tpl) return
    setSubject(tpl.subject ? applyTemplate(tpl.subject, customerName, customerCompany) : '')
    setBody(applyTemplate(tpl.body, customerName, customerCompany))
  }

  async function handleSend() {
    if (!to || !subject || !body) {
      toast.error('Preenche destinatário, assunto e corpo.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customerId, to, subject, body }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Erro desconhecido')
      toast.success('Email enviado!')
      handleClose()
    } catch (err) {
      toast.error('Erro ao enviar email.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    setSubject('')
    setBody('')
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent
        className="max-w-xl"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--foreground)' }}>Enviar email</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* To */}
          <div className="space-y-1.5">
            <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>Para</Label>
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="email@exemplo.com"
              style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            />
          </div>

          {/* Template selector */}
          {templates.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>Template (opcional)</Label>
              <Select onValueChange={applyTemplateById}>
                <SelectTrigger style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)' }}>
                  <SelectValue placeholder="Escolher template…" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Subject */}
          <div className="space-y-1.5">
            <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>Assunto</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Assunto do email"
              style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            />
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>Mensagem</Label>
            <Textarea
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Escreve a mensagem aqui…"
              style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)', resize: 'none' }}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button
            variant="outline"
            onClick={handleClose}
            style={{ border: '1px solid var(--border)', color: 'var(--foreground)', background: 'transparent' }}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSend}
            disabled={loading || !to || !subject || !body}
            style={{ background: 'var(--primary)', color: '#fff' }}
          >
            {loading ? 'A enviar…' : 'Enviar email'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
