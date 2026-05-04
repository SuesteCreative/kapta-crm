'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TagInput } from '@/components/ui/tag-input'
import { Copy, Check, Sparkles, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import {
  PLATFORMS, INPUT_PLATFORMS, OUTPUT_PLATFORMS,
  PLATFORM_LABELS, INPUT_PLATFORM_LABELS, OUTPUT_PLATFORM_LABELS,
  type CustomerWithIdentifiers, type Interaction,
  type Platform, type InputPlatform, type OutputPlatform,
} from '@/lib/database.types'
import { extractTicketHints } from '@/lib/extract-ticket-fields'
import { stripHtml } from '@/lib/html-utils'

interface Props {
  open: boolean
  customer: CustomerWithIdentifiers
  interactions?: Interaction[]
  sourceInteractionId?: string | null
  onClose: () => void
}

interface FormState {
  title: string
  description: string
  steps_to_reproduce: string
  expected_behavior: string
  actual_behavior: string
  priority: string
  status: string
  tags: string
  platform: '' | Platform
  input_platform: '' | InputPlatform
  output_platform: '' | OutputPlatform
  account_number: string
  references_list: string[]
}

const EMPTY_FORM: FormState = {
  title: '', description: '', steps_to_reproduce: '', expected_behavior: '',
  actual_behavior: '', priority: 'medium', status: 'open', tags: '',
  platform: '', input_platform: '', output_platform: '',
  account_number: '', references_list: [],
}

function buildTicketText(form: FormState, customer: CustomerWithIdentifiers): string {
  const platformLine = form.platform ? PLATFORM_LABELS[form.platform] : '—'
  const inputLine    = form.input_platform ? INPUT_PLATFORM_LABELS[form.input_platform] : '—'
  const outputLine   = form.output_platform ? OUTPUT_PLATFORM_LABELS[form.output_platform] : '—'
  const refsLine     = form.references_list.length > 0
    ? form.references_list.map((r) => `\`${r}\``).join(', ')
    : '—'

  return `# 🎫 Ticket — ${form.title}

**Cliente:** ${customer.name}${customer.company ? ` (${customer.company})` : ''}
**Plano:** ${customer.plan ?? 'N/A'}
**Prioridade:** ${form.priority.toUpperCase()}
**Estado:** ${form.status}

**Plataforma:** ${platformLine}
**Input:** ${inputLine}
**Output:** ${outputLine}
**Conta:** ${form.account_number || '—'}
**Referências:** ${refsLine}

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

export function TicketBuilderDialog({ open, customer, interactions = [], sourceInteractionId = null, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [aiInstruction, setAiInstruction] = useState('')

  async function runSuggest(instruction?: string) {
    if (interactions.length === 0) return
    setSuggesting(true)
    try {
      const res = await fetch('/api/ai/suggest-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: customer.name,
          customer_company: customer.company ?? null,
          user_instruction: instruction?.trim() || null,
          interactions: interactions.slice(0, 20).map((i) => ({
            type: i.type,
            direction: i.direction,
            subject: i.subject,
            content: i.content,
            occurred_at: i.occurred_at,
            metadata: i.metadata ?? null,
          })),
        }),
      })
      const text = await res.text()
      let json: {
        ok: boolean
        title?: string; description?: string
        steps_to_reproduce?: string | null
        expected_behavior?: string | null
        actual_behavior?: string | null
        priority?: string; tags?: string[]
        platform?: Platform | null
        input_platform?: InputPlatform | null
        output_platform?: OutputPlatform | null
        account_number?: string | null
        references?: string[] | null
      }
      try { json = JSON.parse(text) } catch { return }
      if (!json.ok) return
      setForm((prev) => ({
        ...prev,
        title: json.title ?? prev.title,
        description: json.description ?? prev.description,
        steps_to_reproduce: json.steps_to_reproduce ?? prev.steps_to_reproduce,
        expected_behavior: json.expected_behavior ?? prev.expected_behavior,
        actual_behavior: json.actual_behavior ?? prev.actual_behavior,
        priority: json.priority ?? prev.priority,
        tags: (json.tags ?? []).join(', ') || prev.tags,
        // Prefer existing (regex/manual) values; fill blanks from AI.
        platform: prev.platform || (json.platform ?? ''),
        input_platform: prev.input_platform || (json.input_platform ?? ''),
        output_platform: prev.output_platform || (json.output_platform ?? ''),
        account_number: prev.account_number || (json.account_number ?? ''),
        references_list: prev.references_list.length ? prev.references_list : (json.references ?? []),
      }))
    } finally {
      setSuggesting(false)
    }
  }

  // Auto-suggest + regex prefill when dialog opens with interactions
  useEffect(() => {
    if (!open) return
    setForm(EMPTY_FORM)
    setAiInstruction('')
    if (interactions.length === 0) return

    // Regex prefill (synchronous, deterministic) — uses last 8 emails
    const bodies = interactions.slice(0, 8).map((i) => stripHtml(i.content ?? '')).join('\n\n')
    const hints = extractTicketHints(bodies)

    setForm((prev) => ({
      ...prev,
      platform: hints.platform ?? '',
      input_platform: hints.input_platform ?? '',
      output_platform: hints.output_platform ?? '',
      account_number: hints.account_number ?? '',
      references_list: hints.references ?? [],
    }))

    runSuggest()
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
        platform: form.platform || null,
        input_platform: form.input_platform || null,
        output_platform: form.output_platform || null,
        account_number: form.account_number.trim() || null,
        references_list: form.references_list,
        source_interaction_id: sourceInteractionId,
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
    if (!form.platform) { toast.error('Escolha a plataforma antes de copiar.'); return }
    await navigator.clipboard.writeText(ticketText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success('Ticket copiado!')
  }

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value })

  const hasPrefill = !!(form.platform || form.input_platform || form.output_platform || form.account_number || form.references_list.length > 0)

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
            {!suggesting && hasPrefill && interactions.length > 0 && (
              <span className="flex items-center gap-1 text-[11px] font-normal rounded-full px-2 py-0.5" style={{ background: 'rgba(45,185,117,0.1)', color: 'var(--status-active)' }}>
                Detectado do email
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
            {interactions.length > 0 && (
              <div className="space-y-1.5 rounded-lg p-3" style={{ background: 'rgba(91,91,214,0.06)', border: '1px solid rgba(91,91,214,0.2)' }}>
                <Label className="text-[12px]" style={{ color: 'var(--primary)' }}>
                  Instruções para a IA (opcional)
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={aiInstruction}
                    onChange={(e) => setAiInstruction(e.target.value)}
                    placeholder="ex. focar em Shopify, prioridade alta, ignorar email mais antigo…"
                    disabled={suggesting}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => runSuggest(aiInstruction)}
                    disabled={suggesting}
                    className="shrink-0 gap-1.5"
                  >
                    {suggesting
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> A analisar…</>
                      : <><Sparkles className="h-3.5 w-3.5" /> Re-gerar</>}
                  </Button>
                </div>
              </div>
            )}
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

            {/* Platform mapping */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Plataforma *</Label>
                <Select
                  value={form.platform || undefined}
                  onValueChange={(v) => setForm({ ...form, platform: v as Platform })}
                >
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map((p) => (
                      <SelectItem key={p} value={p}>{PLATFORM_LABELS[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Input</Label>
                <Select
                  value={form.input_platform || undefined}
                  onValueChange={(v) => setForm({ ...form, input_platform: v as InputPlatform })}
                >
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {INPUT_PLATFORMS.map((p) => (
                      <SelectItem key={p} value={p}>{INPUT_PLATFORM_LABELS[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Output</Label>
                <Select
                  value={form.output_platform || undefined}
                  onValueChange={(v) => setForm({ ...form, output_platform: v as OutputPlatform })}
                >
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {OUTPUT_PLATFORMS.map((p) => (
                      <SelectItem key={p} value={p}>{OUTPUT_PLATFORM_LABELS[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Account + References */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Nº de conta</Label>
                <Input
                  value={form.account_number}
                  onChange={f('account_number')}
                  placeholder="acct_xxx, ID do cliente…"
                  disabled={suggesting}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Referências (Enter / vírgula)</Label>
                <TagInput
                  value={form.references_list}
                  onChange={(refs) => setForm({ ...form, references_list: refs })}
                  placeholder="pi_xxx, ch_xxx, EP123…"
                  disabled={suggesting}
                />
              </div>
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
