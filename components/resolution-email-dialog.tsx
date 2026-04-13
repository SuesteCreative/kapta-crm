'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sparkles, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface TicketData {
  title: string
  description: string | null
  actual_behavior: string | null
  expected_behavior: string | null
  steps_to_reproduce: string | null
  tags: string[]
}

interface Props {
  open: boolean
  customerId: string
  customerName: string
  customerCompany: string | null
  customerEmail: string | null
  ticket: TicketData
  onSend: () => void    // called after email sent (or skipped)
  onSkip: () => void    // update status without email
  onClose: () => void   // cancel: don't update status
}

export function ResolutionEmailDialog({
  open, customerId, customerName, customerCompany, customerEmail, ticket,
  onSend, onSkip, onClose,
}: Props) {
  const [to,       setTo]       = useState(customerEmail ?? '')
  const [subject,  setSubject]  = useState('')
  const [body,     setBody]     = useState('')
  const [drafting, setDrafting] = useState(false)
  const [sending,  setSending]  = useState(false)

  // Auto-draft when dialog opens
  useEffect(() => {
    if (!open) return
    setTo(customerEmail ?? '')
    setSubject(`Resolução: ${ticket.title}`)
    setBody('')
    generateDraft()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function generateDraft() {
    setDrafting(true)
    try {
      const res = await fetch('/api/ai/draft-resolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_name: customerName, customer_company: customerCompany, ticket }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      if (json.subject) setSubject(json.subject)
      if (json.body) setBody(json.body)
    } catch {
      toast.error('Erro ao gerar rascunho — preenche manualmente.')
    } finally {
      setDrafting(false)
    }
  }

  async function handleSend() {
    if (!to || !subject || !body) {
      toast.error('Preenche destinatário, assunto e corpo.')
      return
    }
    setSending(true)
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customerId, to, subject, body }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Erro')
      toast.success('Email de resolução enviado!')
      onSend()
    } catch {
      toast.error('Erro ao enviar email.')
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-xl"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--foreground)' }}>
            Enviar email de resolução
          </DialogTitle>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
            O ticket foi marcado como resolvido. Queres avisar o cliente?
          </p>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Loading state */}
          {drafting && (
            <div className="flex items-center gap-2 py-2" style={{ color: 'var(--muted-foreground)' }}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="text-sm">A gerar rascunho…</span>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Para</Label>
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="email@cliente.com"
              className="h-8 text-sm"
              style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Assunto</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="h-8 text-sm"
              style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Corpo</Label>
              <button
                onClick={generateDraft}
                disabled={drafting}
                className="flex items-center gap-1 text-[11px] transition-opacity hover:opacity-70 disabled:opacity-40"
                style={{ color: 'var(--primary)' }}
              >
                {drafting
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Sparkles className="h-3 w-3" />}
                Regenerar
              </button>
            </div>
            <Textarea
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Corpo do email…"
              style={{ background: 'var(--muted)', border: '1px solid var(--border)', fontSize: 13 }}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} className="text-xs h-8">
            Cancelar
          </Button>
          <Button
            variant="outline"
            onClick={onSkip}
            className="text-xs h-8"
            style={{ border: '1px solid var(--border)', color: 'var(--muted-foreground)' }}
          >
            Fechar sem enviar
          </Button>
          <Button
            onClick={handleSend}
            disabled={sending || drafting || !to}
            className="text-xs h-8 gap-1.5"
            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            {sending && <Loader2 className="h-3 w-3 animate-spin" />}
            Enviar email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
