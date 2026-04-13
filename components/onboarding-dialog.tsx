'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, CheckSquare, Mail, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

// ─── Onboarding templates ────────────────────────────────────────────────────
// Each step becomes a follow-up. Due dates are offset from today (days).
type OnboardingStep = { title: string; description: string; daysOffset: number; priority: 'low' | 'medium' | 'high' | 'urgent' }

const ONBOARDING_TEMPLATES: Record<string, { label: string; steps: OnboardingStep[]; emailSubject: string; emailBody: string }> = {
  stripe_moloni: {
    label: 'Stripe + Moloni',
    emailSubject: 'Integração Stripe + Moloni — Próximos passos',
    emailBody: `Bom dia.
Espero que se encontre bem.

O meu nome é Pedro e sou o responsável pelas integrações da Kapta. Recebi o seu pedido de integração entre Stripe e Moloni e estou aqui para ajudar.

Para o processo de onboarding deve seguir os passos do nosso site, aqui: https://kapta.pt/onboarding/stripe-moloni/

Seguindo todos os passos os dados de ambas as suas contas ficaram ligados, depois será apenas necessário ativar a subscrição e ficará tudo a funcionar corretamente.

Se precisar de assistência com este processo poderá agendar uma reunião comigo para que consiga acompanhar o processo e auxiliar da melhor maneira.
Segue o meu calendly: https://calendly.com/pedro-kapta/apoio-kapta

Se tiver alguma questão, não hesite em contactar.`,
    steps: [
      { title: 'Enviar email de onboarding ao cliente', description: 'Email enviado com link para https://kapta.pt/onboarding/stripe-moloni/', daysOffset: 0, priority: 'high' },
      { title: 'Verificar se cliente completou o onboarding', description: 'Confirmar que seguiu todos os passos do site e que as contas ficaram ligadas', daysOffset: 3, priority: 'medium' },
      { title: 'Ativar subscrição no rioko.pt', description: 'Após confirmação do cliente, ativar subscrição para que a integração funcione', daysOffset: 5, priority: 'high' },
      { title: 'Confirmar que está tudo a funcionar', description: 'Validar com o cliente que a sincronização Stripe↔Moloni está operacional', daysOffset: 7, priority: 'medium' },
      { title: 'Acompanhamento pós-onboarding', description: 'Check-in 2 semanas após go-live — verificar se há dúvidas ou erros', daysOffset: 21, priority: 'low' },
    ],
  },
  stripe_invoicexpress: {
    label: 'Stripe + InvoiceXpress',
    emailSubject: 'Integração Stripe + InvoiceXpress — Próximos passos',
    emailBody: `Bom dia.
Espero que se encontre bem.

O meu nome é Pedro e sou o responsável pelas integrações da Kapta. Recebi o seu pedido de integração entre Stripe e InvoiceXpress e estou aqui para ajudar.

A integração Stripe + InvoiceXpress está disponível diretamente através do Stripe Marketplace. Poderá instalar a app aqui: https://marketplace.stripe.com/apps/invoicexpress

Se precisar de acompanhamento durante a configuração, pode agendar uma reunião comigo:
https://calendly.com/pedro-kapta/apoio-kapta

Se tiver alguma questão, não hesite em contactar.`,
    steps: [
      { title: 'Enviar email de onboarding ao cliente', description: 'Email enviado com link para a app no Stripe Marketplace', daysOffset: 0, priority: 'high' },
      { title: 'Confirmar instalação da app InvoiceXpress no Stripe', description: 'Verificar que o cliente instalou e configurou a app corretamente', daysOffset: 3, priority: 'medium' },
      { title: 'Validar emissão de faturas automáticas', description: 'Confirmar que as faturas estão a ser geradas após pagamento Stripe', daysOffset: 5, priority: 'high' },
      { title: 'Acompanhamento pós-onboarding', description: 'Check-in 2 semanas após go-live', daysOffset: 21, priority: 'low' },
    ],
  },
  fareharbor_moloni: {
    label: 'FareHarbor + Moloni',
    emailSubject: 'Integração FareHarbor + Moloni — Próximos passos',
    emailBody: `Bom dia.
Espero que se encontre bem.

O meu nome é Pedro e sou o responsável pelas integrações da Kapta. Recebi o seu pedido de integração FareHarbor + Moloni e estou aqui para ajudar.

Para iniciar esta integração é necessário pedir o acesso à API do FareHarbor, e ter a conta Moloni já ativa, com a ligação à ATCUD feita, série de faturação registada e plano Flex ou superior ativo, para poder ter acesso à API do Moloni.

Como parceiros da FareHarbor, temos um formulário de pedido de API. Basta preencher com os seus dados e a equipa FareHarbor irá contactar diretamente a Kapta com a sua API (geralmente leva entre 1h a 2 dias úteis): https://kapta.pt/fareharbor

Para finalizar a integração peço para marcar uma reunião para podermos ligar tudo em conjunto e tirar quaisquer dúvidas relativas à integração.
Seguem as minhas disponibilidades: https://calendly.com/pedro-kapta/apoio-kapta

Se tiver alguma questão, não hesite em contactar.`,
    steps: [
      { title: 'Enviar email com formulário FareHarbor + requisitos Moloni', description: 'Email enviado com link para https://kapta.pt/fareharbor e checklist Moloni (ATCUD, série, plano Flex+)', daysOffset: 0, priority: 'high' },
      { title: 'Confirmar que formulário FareHarbor foi submetido', description: 'Verificar com cliente que preencheu o formulário em kapta.pt/fareharbor', daysOffset: 1, priority: 'medium' },
      { title: 'Aguardar API FareHarbor (1h–2 dias úteis)', description: 'A equipa FareHarbor contacta a Kapta com a API do cliente — verificar email', daysOffset: 2, priority: 'high' },
      { title: 'Verificar pré-requisitos Moloni do cliente', description: 'ATCUD ativo, série de faturação registada, plano Flex ou superior', daysOffset: 2, priority: 'medium' },
      { title: 'Agendar reunião para ligar as plataformas', description: 'Marcar reunião via Calendly para configurar FareHarbor + Moloni no rioko.pt', daysOffset: 3, priority: 'high' },
      { title: 'Reunião: ligar FareHarbor + Moloni', description: 'Sessão com cliente para configurar a integração e validar os primeiros registos', daysOffset: 5, priority: 'urgent' },
      { title: 'Confirmar que está tudo operacional', description: 'Verificar que as reservas FareHarbor estão a gerar faturas Moloni corretamente', daysOffset: 7, priority: 'medium' },
      { title: 'Acompanhamento pós-onboarding', description: 'Check-in 2 semanas após go-live', daysOffset: 21, priority: 'low' },
    ],
  },
  fareharbor_invoicexpress: {
    label: 'FareHarbor + InvoiceXpress',
    emailSubject: 'Integração FareHarbor + InvoiceXpress — Próximos passos',
    emailBody: `Bom dia.
Espero que se encontre bem.

O meu nome é Pedro e sou o responsável pelas integrações da Kapta. Recebi o seu pedido de integração FareHarbor + InvoiceXpress e estou aqui para ajudar.

Para iniciar esta integração é necessário pedir o acesso à API do FareHarbor. Como parceiros da FareHarbor, temos um formulário de pedido de API: https://kapta.pt/fareharbor

Basta preencher com os seus dados e a equipa FareHarbor irá contactar a Kapta com a sua API (geralmente 1h a 2 dias úteis).

Após recebermos a API, iremos agendar uma reunião para ligar tudo em conjunto.
Seguem as minhas disponibilidades: https://calendly.com/pedro-kapta/apoio-kapta

Se tiver alguma questão, não hesite em contactar.`,
    steps: [
      { title: 'Enviar email com formulário FareHarbor', description: 'Email enviado com link para https://kapta.pt/fareharbor', daysOffset: 0, priority: 'high' },
      { title: 'Confirmar que formulário FareHarbor foi submetido', description: 'Verificar com cliente que preencheu o formulário', daysOffset: 1, priority: 'medium' },
      { title: 'Aguardar API FareHarbor (1h–2 dias úteis)', description: 'A equipa FareHarbor contacta a Kapta com a API do cliente', daysOffset: 2, priority: 'high' },
      { title: 'Agendar reunião para ligar as plataformas', description: 'Marcar reunião via Calendly para configurar FareHarbor + InvoiceXpress', daysOffset: 3, priority: 'high' },
      { title: 'Reunião: ligar FareHarbor + InvoiceXpress', description: 'Sessão com cliente para configurar a integração', daysOffset: 5, priority: 'urgent' },
      { title: 'Confirmar que está tudo operacional', description: 'Verificar que as reservas estão a gerar faturas InvoiceXpress corretamente', daysOffset: 7, priority: 'medium' },
      { title: 'Acompanhamento pós-onboarding', description: 'Check-in 2 semanas após go-live', daysOffset: 21, priority: 'low' },
    ],
  },
  personalizado: {
    label: 'Integração personalizada (quote)',
    emailSubject: 'Integração Kapta — Próximos passos',
    emailBody: `Bom dia.
Espero que se encontre bem.

O meu nome é Pedro e sou o responsável pelas integrações da Kapta. Recebi o seu pedido e estou aqui para ajudar.

Para este tipo de integração, vamos agendar uma reunião inicial para perceber os requisitos e apresentar uma proposta. Segue o meu calendly: https://calendly.com/pedro-kapta/apoio-kapta

Se tiver alguma questão, não hesite em contactar.`,
    steps: [
      { title: 'Enviar email de resposta inicial ao cliente', description: 'Email enviado com link Calendly para reunião de levantamento', daysOffset: 0, priority: 'high' },
      { title: 'Reunião de levantamento de requisitos', description: 'Perceber o que o cliente precisa e definir âmbito do projeto', daysOffset: 5, priority: 'high' },
      { title: 'Elaborar e enviar proposta/quote', description: 'Preparar estimativa de prazo e custo e enviar ao cliente', daysOffset: 10, priority: 'high' },
      { title: 'Aguardar aprovação da proposta', description: 'Seguir com o cliente até confirmação formal', daysOffset: 17, priority: 'medium' },
      { title: 'Desenvolvimento e configuração', description: 'Implementar a integração conforme especificações aprovadas', daysOffset: 35, priority: 'medium' },
      { title: 'Testes e validação com o cliente', description: 'Sessão conjunta para validar antes do go-live', daysOffset: 40, priority: 'high' },
      { title: 'Go-live e email de confirmação', description: 'Ativar em produção e confirmar com o cliente', daysOffset: 45, priority: 'medium' },
      { title: 'Acompanhamento pós-projeto', description: 'Check-in após 1 mês para avaliar satisfação', daysOffset: 75, priority: 'low' },
    ],
  },
}

interface Props {
  open: boolean
  customerId: string
  customerName: string
  customerEmail: string | null
  onClose: () => void
}

export function OnboardingDialog({ open, customerId, customerName, customerEmail, onClose }: Props) {
  const [type,     setType]     = useState<string>('stripe_moloni')
  const [step,     setStep]     = useState<'pick' | 'preview'>('pick')
  const [loading,  setLoading]  = useState(false)
  const [sendEmail, setSendEmail] = useState(true)

  const template = ONBOARDING_TEMPLATES[type] ?? ONBOARDING_TEMPLATES['stripe_moloni']

  function handleClose() {
    setStep('pick')
    setType('shopify')
    setSendEmail(true)
    onClose()
  }

  async function startOnboarding() {
    setLoading(true)
    try {
      const today = new Date()
      const followUps = template.steps.map((s) => {
        const due = new Date(today)
        due.setDate(due.getDate() + s.daysOffset)
        return {
          customer_id: customerId,
          title: s.title,
          description: s.description,
          due_date: due.toISOString().slice(0, 10),
          priority: s.priority,
          status: 'open',
        }
      })

      const { error: fuErr } = await supabase.from('follow_ups').insert(followUps)
      if (fuErr) throw fuErr

      if (sendEmail && customerEmail) {
        await fetch('/api/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id: customerId,
            to: customerEmail,
            subject: template.emailSubject,
            body: template.emailBody,
          }),
        })
      }

      toast.success(`Onboarding iniciado — ${template.steps.length} follow-ups criados${sendEmail && customerEmail ? ' e email enviado' : ''}.`)
      handleClose()
    } catch {
      toast.error('Erro ao iniciar onboarding.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent
        className="max-w-lg"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--foreground)' }}>
            Iniciar onboarding — {customerName}
          </DialogTitle>
        </DialogHeader>

        {step === 'pick' && (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Tipo de integração</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ONBOARDING_TEMPLATES).map(([key, t]) => (
                    <SelectItem key={key} value={key}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div
              className="rounded-lg p-3 space-y-1.5"
              style={{ background: 'var(--muted)' }}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted-foreground)' }}>
                {template.steps.length} follow-ups serão criados
              </p>
              {template.steps.map((s, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-[11px] font-mono mt-0.5 shrink-0" style={{ color: 'var(--muted-foreground)' }}>
                    +{s.daysOffset}d
                  </span>
                  <span className="text-[12px]" style={{ color: 'var(--foreground)' }}>{s.title}</span>
                </div>
              ))}
            </div>

            {customerEmail && (
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendEmail}
                  onChange={(e) => setSendEmail(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm" style={{ color: 'var(--foreground)' }}>
                  Enviar email de boas-vindas para <span style={{ color: 'var(--primary)' }}>{customerEmail}</span>
                </span>
              </label>
            )}
            {!customerEmail && (
              <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                Sem email associado — follow-ups criados, mas email não será enviado.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={handleClose} className="text-xs h-8">Cancelar</Button>
          {step === 'pick' && (
            <>
              <Button
                variant="outline"
                onClick={() => setStep('preview')}
                className="text-xs h-8 gap-1"
                style={{ border: '1px solid var(--border)' }}
              >
                Ver email <ChevronRight className="h-3 w-3" />
              </Button>
              <Button
                onClick={startOnboarding}
                disabled={loading}
                className="text-xs h-8 gap-1.5"
                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                <CheckSquare className="h-3 w-3" /> Iniciar
              </Button>
            </>
          )}
          {step === 'preview' && (
            <>
              <Button variant="ghost" onClick={() => setStep('pick')} className="text-xs h-8">Voltar</Button>
              <Button
                onClick={startOnboarding}
                disabled={loading}
                className="text-xs h-8 gap-1.5"
                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                <Mail className="h-3 w-3" /> Confirmar e iniciar
              </Button>
            </>
          )}
        </DialogFooter>

        {/* Email preview step */}
        {step === 'preview' && (
          <div className="space-y-2 py-2 -mt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted-foreground)' }}>
              Email que será enviado
            </p>
            <div
              className="rounded-lg p-3 space-y-2"
              style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}
            >
              <p className="text-xs font-medium" style={{ color: 'var(--foreground)' }}>
                Assunto: {template.emailSubject}
              </p>
              <pre className="text-xs whitespace-pre-wrap" style={{ color: 'var(--muted-foreground)', fontFamily: 'inherit' }}>
                {template.emailBody}
              </pre>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
