import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SYSTEM_PROMPT = `És um assistente de CRM para Pedro, um account manager B2B português na Kapta.

Dado um histórico de interações com um cliente, gera um resumo executivo MUITO BREVE da situação atual.

Responde com um JSON com:
- situation: string (1-2 frases que descrevem o problema/situação atual do cliente — direto ao ponto, sem introduções)
- urgency: "critical" | "high" | "normal" | "good"
- next_action: string (1 frase: o que Pedro deve fazer agora — verbo de ação no infinitivo)

Regras:
- situation: Escreve como se fosses resumir para Pedro em 5 segundos. Ex: "Kelcie reporta falhas no webhook Stripe há 3 dias — problema crítico não resolvido, aguarda resposta de Pedro."
- urgency: "critical" se problema técnico urgente/financeiro sem resposta; "high" se há dias sem resposta ou assunto pendente; "normal" se situação estável; "good" se tudo ok
- next_action deve ser concreto: "Responder ao email sobre o webhook Stripe" não "Acompanhar cliente"
- Se não houver problema claro, descreve simplesmente o estado da relação
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

type SummaryRequest = {
  customer_name: string
  customer_company: string | null
  interactions: Array<{
    type: string
    direction: string | null
    subject: string | null
    content: string | null
    occurred_at: string
  }>
  open_follow_ups: number
  open_tickets: number
}

export async function POST(req: Request) {
  const { customer_name, customer_company, interactions, open_follow_ups, open_tickets } =
    await req.json() as SummaryRequest

  if (!interactions || interactions.length === 0) {
    return NextResponse.json({ ok: false, error: 'Sem interações.' }, { status: 400 })
  }

  // Last 10 interactions, most recent first
  const recent = interactions.slice(0, 10)

  const interactionText = recent.map((i) => {
    const dir = i.direction === 'inbound' ? '← cliente' : '→ Pedro'
    const content = i.content ? stripHtml(i.content).slice(0, 300) : '(sem conteúdo)'
    return `[${new Date(i.occurred_at).toLocaleDateString('pt-PT')} ${i.type} ${dir}] ${i.subject ? `Assunto: ${i.subject} — ` : ''}${content}`
  }).join('\n\n')

  const prompt = `Cliente: ${customer_name}${customer_company ? ` (${customer_company})` : ''}
Follow-ups abertos: ${open_follow_ups}
Tickets abertos: ${open_tickets}

Interações recentes (mais recente primeiro):
${interactionText}

Gera o resumo da situação atual deste cliente.`

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
