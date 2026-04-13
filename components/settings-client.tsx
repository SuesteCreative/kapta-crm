'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { Save } from 'lucide-react'

interface Props {
  initialSignature: string
}

export function SettingsClient({ initialSignature }: Props) {
  const [signature, setSignature] = useState(initialSignature)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      // Upsert: if a signature template exists, update it; otherwise insert
      const { data: existing } = await supabase
        .from('templates')
        .select('id')
        .eq('type', 'signature')
        .eq('name', '__signature__')
        .maybeSingle()

      if (existing) {
        const { error } = await supabase
          .from('templates')
          .update({ body: signature })
          .eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('templates')
          .insert({ name: '__signature__', type: 'signature', subject: null, body: signature })
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
    <div className="p-7 max-w-[640px] mx-auto space-y-6 animate-fade-in">

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
        <div>
          <h2 className="text-[15px] font-semibold" style={{ color: 'var(--foreground)' }}>
            Assinatura de email
          </h2>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
            Adicionada automaticamente a cada email enviado pelo CRM.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
            Assinatura
          </Label>
          <Textarea
            rows={8}
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder={`Pedro Silva\nKapta · pedro@kapta.pt\n+351 912 345 678`}
            className="font-mono text-[13px]"
            style={{
              background: 'var(--muted)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
              resize: 'vertical',
            }}
          />
          <p className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
            Texto simples. Adicionado após um separador — ao corpo da mensagem.
          </p>
        </div>

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
