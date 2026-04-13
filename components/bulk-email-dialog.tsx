'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import type { Template } from '@/lib/database.types'

interface ClusterInfo {
  issue_title: string
  customer_ids: string[]
  customers: Array<{ id: string; name: string; company: string | null }>
}

interface Props {
  open: boolean
  cluster: ClusterInfo
  onClose: () => void
}

export function BulkEmailDialog({ open, cluster, onClose }: Props) {
  const [subject,   setSubject]   = useState('')
  const [body,      setBody]      = useState('')
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading,   setLoading]   = useState(false)

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
    // Generic substitutions — bulk send, no single customer context
    const genericBody = (tpl.body ?? '')
      .replace(/\{\{name\}\}/gi, 'cliente')
      .replace(/\{\{company\}\}/gi, 'vossa empresa')
    setSubject(tpl.subject?.replace(/\{\{name\}\}/gi, 'cliente') ?? '')
    setBody(genericBody)
  }

  async function handleSend() {
    if (!subject.trim() || !body.trim()) {
      toast.error('Preenche assunto e corpo.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/email/send-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_ids: cluster.customer_ids, subject, body }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Erro desconhecido')
      toast.success(
        `${data.sent} email(s) enviado(s)${data.failed > 0 ? `, ${data.failed} falharam` : '!'}`
      )
      if (data.failed === 0) handleClose()
    } catch (err) {
      toast.error('Erro ao enviar emails.')
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
          <DialogTitle style={{ color: 'var(--foreground)' }}>
            Enviar email a todos — {cluster.issue_title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Recipient chips (read-only) */}
          <div className="space-y-1.5">
            <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
              Para ({cluster.customers.length} clientes)
            </Label>
            <div className="flex flex-wrap gap-1.5 rounded-lg p-2.5" style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}>
              {cluster.customers.map((c) => (
                <span
                  key={c.id}
                  className="text-[11px] font-medium rounded-full px-2.5 py-0.5"
                  style={{ background: 'rgba(91,91,214,0.12)', color: 'var(--primary)' }}
                >
                  {c.name}{c.company ? ` · ${c.company}` : ''}
                </span>
              ))}
            </div>
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
              rows={8}
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
            disabled={loading || !subject.trim() || !body.trim()}
            style={{ background: 'var(--primary)', color: '#fff' }}
          >
            {loading
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />A enviar…</>
              : `Enviar a ${cluster.customer_ids.length} clientes`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
