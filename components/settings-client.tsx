'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { Save, Eye, Code, Link2, Brain, Wrench } from 'lucide-react'

const DEFAULT_SIGNATURE_HTML = `<div style="font-family:Arial,Helvetica,sans-serif;color:#2d2d2d;font-size:13px;line-height:1.6;border-top:2px solid #c0272b;padding-top:14px;margin-top:8px;max-width:480px;">

  <p style="margin:0 0 2px;font-style:italic;color:#555;font-size:13px;">Com os melhores cumprimentos,</p>
  <p style="margin:0 0 18px;font-style:italic;color:#555;font-size:13px;">Kind regards,</p>

  <p style="margin:0;font-weight:700;font-size:14px;color:#111;">Pedro Porto</p>
  <p style="margin:0;color:#555;font-size:13px;">Integrations Expert</p>
  <p style="margin:0 0 18px;color:#555;font-size:13px;">+351 968 015 077</p>

  <p style="margin:0 0 14px;line-height:1;">
    <span style="font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:900;color:#1a1a2e;letter-spacing:-1.5px;">kapta<span style="color:#c0272b;">.</span></span>
  </p>

  <p style="margin:0 0 10px;"><a href="https://www.kapta.pt" style="color:#1a1a2e;font-weight:600;font-size:13px;text-decoration:underline;">www.kapta.pt</a></p>

  <p style="margin:0 0 3px;font-size:12px;color:#444;"><strong>Tel.:</strong> (+351) 91 701 10 57 <span style="font-size:10px;color:#888;">(custo de chamada para rede móvel nacional)</span></p>
  <p style="margin:0 0 3px;font-size:12px;color:#444;"><strong>HQ.:</strong> Urbanização O Monte Lt1, Loja 11 8200-428 Galé, Albufeira</p>
  <p style="margin:0 0 3px;font-size:12px;color:#444;"><strong>Faro:</strong> Av.5 de Outubro, nº 82-A 8000-076 Faro</p>
  <p style="margin:0;font-size:12px;color:#444;"><strong>London:</strong> 38-39 St John's Ln, London EC1M 4BJ, United Kingdom</p>

</div>`

const DEFAULT_AI_MEMORY = `## Integrações
- (ex) Stripe: webhook em /api/stripe/webhook; erros comuns de IVA aparecem quando...

## Troubleshoots recorrentes
- (ex) Duplicados IMO Portugal → conflito de identifier, usar /api/customers/relink-all

## Tom e estilo
- (ex) Português europeu sempre; "cumprimentos" e não "saudações"
- (ex) Técnico mas acessível; evita jargão desnecessário

## Clientes chave
- (ex) Bruno (noreply@...): sempre responder em 24h
`

interface Props {
  initialSignature: string
  initialMemory: string
}

export function SettingsClient({ initialSignature, initialMemory }: Props) {
  const [html, setHtml] = useState(initialSignature || DEFAULT_SIGNATURE_HTML)
  const [memory, setMemory] = useState(initialMemory || DEFAULT_AI_MEMORY)
  const [savingMemory, setSavingMemory] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<'preview' | 'code'>('preview')
  const [relinking, setRelinking] = useState(false)
  const [relinkPreview, setRelinkPreview] = useState<{ total: number; groups: number } | null>(null)
  const [backfilling, setBackfilling] = useState(false)
  const [backfillPreview, setBackfillPreview] = useState<{ scanned: number; affected: number } | null>(null)

  async function handleBackfillPreview() {
    setBackfilling(true)
    try {
      const res = await fetch('/api/imap/backfill-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: true }),
      })
      const data = await res.json()
      if (!data.ok) { toast.error(data.error ?? 'Erro.'); return }
      if (data.affected === 0) {
        toast.success('Nenhum email com encoding partido encontrado.')
        return
      }
      setBackfillPreview({ scanned: data.scanned, affected: data.affected })
    } catch {
      toast.error('Erro ao verificar emails.')
    } finally {
      setBackfilling(false)
    }
  }

  async function handleBackfillConfirm() {
    setBackfilling(true)
    try {
      const res = await fetch('/api/imap/backfill-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!data.ok) { toast.error(data.error ?? 'Erro.'); return }
      toast.success(`${data.updated} email(s) corrigidos.`)
    } catch {
      toast.error('Erro ao corrigir emails.')
    } finally {
      setBackfilling(false)
      setBackfillPreview(null)
    }
  }

  async function handleSaveMemory() {
    setSavingMemory(true)
    try {
      const { data: existing } = await supabase
        .from('templates')
        .select('id')
        .eq('name', '__ai_memory__')
        .maybeSingle()

      if (existing) {
        const { error } = await supabase
          .from('templates')
          .update({ body: memory })
          .eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('templates')
          .insert({ name: '__ai_memory__', type: 'note', subject: null, body: memory })
        if (error) throw error
      }

      toast.success('Contexto IA guardado!')
    } catch (e) {
      toast.error('Erro ao guardar contexto IA.')
      console.error(e)
    } finally {
      setSavingMemory(false)
    }
  }

  async function handleRelinkPreview() {
    setRelinking(true)
    try {
      const res = await fetch('/api/customers/relink-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: true }),
      })
      const data = await res.json()
      if (!data.ok) { toast.error(data.error); return }
      if (data.total === 0) {
        toast.success('Nenhuma interação mal-ligada encontrada.')
        return
      }
      setRelinkPreview({ total: data.total, groups: data.groups })
    } catch {
      toast.error('Erro ao verificar interações.')
    } finally {
      setRelinking(false)
    }
  }

  async function handleRelinkConfirm() {
    setRelinking(true)
    try {
      const res = await fetch('/api/customers/relink-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })
      const data = await res.json()
      if (!data.ok) { toast.error(data.error); return }
      toast.success(`${data.moved} interação(ões) re-ligadas com sucesso.`)
      if (data.orphaned_customer_ids?.length > 0) {
        toast.warning(`${data.orphaned_customer_ids.length} cliente(s) duplicado(s) ficaram sem dados — verifique e elimine manualmente.`, { duration: 8000 })
      }
    } catch {
      toast.error('Erro ao re-ligar interações.')
    } finally {
      setRelinking(false)
      setRelinkPreview(null)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const { data: existing } = await supabase
        .from('templates')
        .select('id')
        .eq('name', '__signature__')
        .maybeSingle()

      if (existing) {
        const { error } = await supabase
          .from('templates')
          .update({ body: html })
          .eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('templates')
          .insert({ name: '__signature__', type: 'email', subject: null, body: html })
        if (error) throw error
      }

      toast.success('Assinatura guardada!')
    } catch (e) {
      toast.error('Erro ao guardar assinatura.')
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-7 max-w-[680px] mx-auto space-y-6 animate-fade-in">

      {/* Header */}
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--foreground)' }}>
          Definições
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
          Configurações da conta e preferências
        </p>
      </div>

      {/* Re-link card */}
      <div
        className="rounded-xl p-6 space-y-3"
        style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}
      >
        <div>
          <h2 className="text-[15px] font-semibold" style={{ color: 'var(--foreground)' }}>
            Resolver interações mal-ligadas
          </h2>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
            Encontra e move interações que estão associadas a um cliente errado, com base nos emails registados. Executar uma vez para limpar dados históricos.
          </p>
        </div>

        {relinkPreview ? (
          <div className="space-y-3">
            <p className="text-[13px]" style={{ color: 'var(--foreground)' }}>
              Encontradas <strong>{relinkPreview.total}</strong> interação(ões) em <strong>{relinkPreview.groups}</strong> grupo(s) para mover. Confirmar?
            </p>
            <div className="flex gap-2">
              <Button
                onClick={handleRelinkConfirm}
                disabled={relinking}
                className="gap-2 rounded-lg text-[13px] font-medium"
                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                <Link2 className="h-3.5 w-3.5" />
                {relinking ? 'A re-ligar…' : 'Confirmar re-ligação'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setRelinkPreview(null)}
                disabled={relinking}
                className="rounded-lg text-[13px]"
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button
            onClick={handleRelinkPreview}
            disabled={relinking}
            variant="outline"
            className="gap-2 rounded-lg text-[13px] font-medium"
          >
            <Link2 className="h-3.5 w-3.5" />
            {relinking ? 'A verificar…' : 'Verificar e corrigir'}
          </Button>
        )}
      </div>

      {/* Backfill content card */}
      <div
        className="rounded-xl p-6 space-y-3"
        style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}
      >
        <div className="flex items-start gap-2">
          <Wrench className="h-4 w-4 mt-0.5" style={{ color: 'var(--primary)' }} />
          <div>
            <h2 className="text-[15px] font-semibold" style={{ color: 'var(--foreground)' }}>
              Corrigir encoding de emails antigos
            </h2>
            <p className="text-[13px] mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
              Re-descodifica emails sincronizados antes do fix MIME — boundaries <code>--_000_…</code> e sequências <code>=C3=A7</code> voltam a aparecer como texto legível. Seguro e idempotente.
            </p>
          </div>
        </div>

        {backfillPreview ? (
          <div className="space-y-3">
            <p className="text-[13px]" style={{ color: 'var(--foreground)' }}>
              <strong>{backfillPreview.affected}</strong> email(s) com encoding partido em <strong>{backfillPreview.scanned}</strong> verificados. Corrigir?
            </p>
            <div className="flex gap-2">
              <Button
                onClick={handleBackfillConfirm}
                disabled={backfilling}
                className="gap-2 rounded-lg text-[13px] font-medium"
                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                <Wrench className="h-3.5 w-3.5" />
                {backfilling ? 'A corrigir…' : 'Confirmar correção'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setBackfillPreview(null)}
                disabled={backfilling}
                className="rounded-lg text-[13px]"
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button
            onClick={handleBackfillPreview}
            disabled={backfilling}
            variant="outline"
            className="gap-2 rounded-lg text-[13px] font-medium"
          >
            <Wrench className="h-3.5 w-3.5" />
            {backfilling ? 'A verificar…' : 'Verificar e corrigir'}
          </Button>
        )}
      </div>

      {/* AI Memory card */}
      <div
        className="rounded-xl p-6 space-y-4"
        style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}
      >
        <div className="flex items-start gap-2">
          <Brain className="h-4 w-4 mt-0.5" style={{ color: 'var(--primary)' }} />
          <div>
            <h2 className="text-[15px] font-semibold" style={{ color: 'var(--foreground)' }}>
              Contexto IA (Memory)
            </h2>
            <p className="text-[13px] mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
              Notas sobre integrações, troubleshoots, tom e clientes chave. Injetado no system prompt de todas as ações de IA (rascunho, sugestões, triagem). Usa markdown livre.
            </p>
          </div>
        </div>

        <textarea
          rows={14}
          value={memory}
          onChange={(e) => setMemory(e.target.value)}
          placeholder="## Integrações&#10;- ...&#10;&#10;## Troubleshoots&#10;- ..."
          className="w-full rounded-lg p-3 font-mono text-[12px] leading-relaxed"
          style={{
            background: 'var(--muted)',
            border: '1px solid var(--border)',
            color: 'var(--foreground)',
            resize: 'vertical',
            outline: 'none',
          }}
        />

        <div className="flex items-center justify-between">
          <p className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
            {memory.length} chars · ~{Math.ceil(memory.length / 4)} tokens
          </p>
          <Button
            onClick={handleSaveMemory}
            disabled={savingMemory}
            className="gap-2 rounded-lg text-[13px] font-medium"
            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            <Save className="h-3.5 w-3.5" />
            {savingMemory ? 'A guardar…' : 'Guardar contexto'}
          </Button>
        </div>
      </div>

      {/* Signature card */}
      <div
        className="rounded-xl p-6 space-y-4"
        style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[15px] font-semibold" style={{ color: 'var(--foreground)' }}>
              Assinatura de email
            </h2>
            <p className="text-[13px] mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
              Adicionada automaticamente a cada email enviado pelo CRM.
            </p>
          </div>
          {/* Preview / Code toggle */}
          <div
            className="flex rounded-lg overflow-hidden shrink-0"
            style={{ border: '1px solid var(--border)' }}
          >
            {(['preview', 'code'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium transition-colors"
                style={{
                  background: mode === m ? 'var(--foreground)' : 'transparent',
                  color: mode === m ? 'var(--card)' : 'var(--muted-foreground)',
                }}
              >
                {m === 'preview' ? <Eye className="h-3 w-3" /> : <Code className="h-3 w-3" />}
                {m === 'preview' ? 'Preview' : 'HTML'}
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        {mode === 'preview' && (
          <div
            className="rounded-lg p-4"
            style={{ background: '#ffffff', border: '1px solid var(--border)', minHeight: 200 }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}

        {/* HTML editor */}
        {mode === 'code' && (
          <div className="space-y-1.5">
            <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
              HTML
            </Label>
            <textarea
              rows={16}
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              className="w-full rounded-lg p-3 font-mono text-[12px] leading-relaxed"
              style={{
                background: 'var(--muted)',
                border: '1px solid var(--border)',
                color: 'var(--foreground)',
                resize: 'vertical',
                outline: 'none',
              }}
            />
          </div>
        )}

        <Button
          onClick={handleSave}
          disabled={saving}
          className="gap-2 rounded-lg text-[13px] font-medium"
          style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? 'A guardar…' : 'Guardar assinatura'}
        </Button>
      </div>
    </div>
  )
}
