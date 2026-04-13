'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { Save, Eye, Code } from 'lucide-react'

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

interface Props {
  initialSignature: string
}

export function SettingsClient({ initialSignature }: Props) {
  const [html, setHtml] = useState(initialSignature || DEFAULT_SIGNATURE_HTML)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<'preview' | 'code'>('preview')

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
          style={{ background: 'var(--primary)', color: '#fff' }}
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? 'A guardar…' : 'Guardar assinatura'}
        </Button>
      </div>
    </div>
  )
}
