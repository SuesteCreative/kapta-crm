'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Copy, Check, Trash2, Mail, MessageSquare, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { Template } from '@/lib/database.types'

const TYPE_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  email:    { icon: Mail,          color: '#3B82F6', bg: 'rgba(59,130,246,0.1)',  label: 'Email'    },
  whatsapp: { icon: MessageSquare, color: '#2DB975', bg: 'rgba(45,185,117,0.1)', label: 'WhatsApp' },
  note:     { icon: FileText,      color: '#9CA3AF', bg: 'rgba(156,163,175,0.1)',label: 'Nota'     },
}

export function TemplatesClient({ templates }: { templates: Template[] }) {
  const router  = useRouter()
  const [showNew,   setShowNew]   = useState(false)
  const [copiedId,  setCopiedId]  = useState<string | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [form, setForm] = useState({ name: '', type: 'email', subject: '', body: '' })

  async function saveTemplate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!form.name.trim() || !form.body.trim()) return
    setLoading(true)
    const { error } = await supabase.from('templates').insert({
      name: form.name.trim(),
      type: form.type as 'email' | 'whatsapp' | 'note',
      subject: form.subject || null,
      body: form.body.trim(),
    })
    setLoading(false)
    if (error) { toast.error('Erro ao guardar.'); return }
    toast.success('Template guardado!')
    setForm({ name: '', type: 'email', subject: '', body: '' })
    setShowNew(false)
    router.refresh()
  }

  async function deleteTemplate(id: string) {
    await supabase.from('templates').delete().eq('id', id)
    toast.success('Eliminado.')
    router.refresh()
  }

  async function copyTemplate(t: Template) {
    const text = t.subject ? `Assunto: ${t.subject}\n\n${t.body}` : t.body
    await navigator.clipboard.writeText(text)
    setCopiedId(t.id)
    setTimeout(() => setCopiedId(null), 2000)
    toast.success('Copiado!')
  }

  const grouped = ['email', 'whatsapp', 'note'].map((type) => ({
    type,
    items: templates.filter((t) => t.type === type),
  })).filter((g) => g.items.length > 0)

  return (
    <div className="p-7 max-w-[820px] mx-auto space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--foreground)' }}>
            Templates
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
            {templates.length} templates guardados
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowNew(true)}
          className="gap-1.5 rounded-lg text-[13px] font-medium"
          style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          <Plus className="h-3.5 w-3.5" /> Novo template
        </Button>
      </div>

      {/* Grouped by type */}
      {templates.length === 0 && (
        <div className="rounded-xl p-10 text-center" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
          <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Sem templates. Cria o primeiro.
          </p>
        </div>
      )}

      {grouped.map(({ type, items }) => {
        const cfg = TYPE_CONFIG[type] ?? TYPE_CONFIG.note
        const Icon = cfg.icon
        return (
          <div key={type} className="space-y-2.5">
            {/* Section label */}
            <div className="flex items-center gap-2 px-1">
              <div
                className="w-6 h-6 rounded-md flex items-center justify-center"
                style={{ background: cfg.bg }}
              >
                <Icon className="h-3.5 w-3.5" style={{ color: cfg.color }} />
              </div>
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: cfg.color }}>
                {cfg.label}
              </span>
            </div>

            {items.map((t) => (
              <div
                key={t.id}
                className="rounded-xl p-5 space-y-3"
                style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[14px]" style={{ color: 'var(--foreground)' }}>{t.name}</p>
                    {t.subject && (
                      <p className="text-xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
                        Assunto: {t.subject}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => copyTemplate(t)}
                      className="h-7 w-7 flex items-center justify-center rounded-lg transition-colors"
                      style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}
                      title="Copiar"
                    >
                      {copiedId === t.id
                        ? <Check className="h-3.5 w-3.5" style={{ color: '#2DB975' }} />
                        : <Copy className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={() => deleteTemplate(t.id)}
                      className="h-7 w-7 flex items-center justify-center rounded-lg transition-colors"
                      style={{ background: 'rgba(229,72,77,0.08)', color: '#E5484D' }}
                      title="Eliminar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <pre
                  className="text-sm leading-relaxed whitespace-pre-wrap font-sans rounded-lg p-3"
                  style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}
                >
                  {t.body}
                </pre>
              </div>
            ))}
          </div>
        )
      })}

      {/* New template dialog */}
      <Dialog open={showNew} onOpenChange={(o) => !o && setShowNew(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo template</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveTemplate} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Nome *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Onboarding" required />
              </div>
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="note">Nota</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.type === 'email' && (
              <div className="space-y-1.5">
                <Label>Assunto</Label>
                <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Assunto do email" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Corpo *</Label>
              <Textarea
                rows={7}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                placeholder={'Use {{name}}, {{company}} como variáveis'}
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
              <Button type="submit" disabled={loading} style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}>
                {loading ? 'A guardar…' : 'Guardar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
