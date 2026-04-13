import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SYSTEM_PROMPT = `És um assistente de CRM para Pedro, um account manager B2B português na Kapta.

Dado o histórico de interações com uma empresa cliente (que pode ter vários contactos), gera um resumo executivo MUITO BREVE da situação atual.

Responde com um JSON com:
- situation: string (1-2 frases — qual o estado desta conta, problemas pendentes, último contacto)
- urgency: "critical" | "high" | "normal" | "good"
- next_action: string (1 frase: o que Pedro deve fazer agora — verbo de ação no infinitivo)

Regras:
- situation: direto ao ponto, menciona nomes dos contactos se relevante
- urgency: "critical" se problema técnico urgente sem resposta; "high" se há dias/semanas sem resposta ou assunto pendente; "normal" se situação estável; "good" se tudo ok
- next_action: concreto, ex: "Enviar proposta atualizada a Luís Cabral"
- Retorna APENAS JSON válido, sem markdown`

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

type CompanySummaryRequest = {
  company_name: string
  contacts: Array<{ name: string; status: string }>
  interactions: Array<{
    type: string
    direction: string | null
    subject: string | null
    content: string | null
    occurred_at: string
    customer_name: string
  }>
  open_follow_ups: number
  open_tickets: number
}

export async function POST(req: Request) {
  const body = await req.json() as CompanySummaryRequest
  const { company_name, contacts, interactions, open_follow_ups, open_tickets } = body

  if (!interactions || interactions.length === 0) {
    return NextResponse.json({ ok: false, error: 'Sem interações.' }, { status: 400 })
  }

  const recent = interactions.slice(0, 12)

  const interactionText = recent.map((i) => {
    const dir = i.direction === 'inbound' ? '← cliente' : i.direction === 'outbound' ? '→ Pedro' : ''
    const content = i.content ? stripHtml(i.content).slice(0, 300) : '(sem conteúdo)'
    return `[${new Date(i.occurred_at).toLocaleDateString('pt-PT')} ${i.type} ${dir} — ${i.customer_name}] ${i.subject ? `${i.subject} — ` : ''}${content}`
  }).join('\n\n')

  const contactList = contacts.map((c) => `${c.name} (${c.status})`).join(', ')

  const prompt = `Empresa: ${company_name}
Contactos: ${contactList}
Follow-ups abertos: ${open_follow_ups}
Tickets abertos: ${open_tickets}

Interações recentes (mais recente primeiro):
${interactionText}

Gera o resumo da situação atual desta empresa.`

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }],
  })

  const rawText = message.content[0].type === 'text' ? message.content[0].text : ''
  const match = rawText.match(/\{[\s\S]*\}/)
  const raw = match ? match[0] : '{}'

  try {
    const result = JSON.parse(raw)
    return NextResponse.json({ ok: true, ...result })
  } catch {
    return NextResponse.json({ ok: false, error: 'Erro ao processar.' }, { status: 500 })
  }
}
