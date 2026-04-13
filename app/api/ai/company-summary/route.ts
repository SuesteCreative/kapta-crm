import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SYSTEM_PROMPT = `CRM assistant for Pedro, Portuguese B2B account manager at Kapta. Summarize company account status.

Return JSON:
- situation: string (PT, 1-2 sentences, direct, mention contact names if relevant)
- urgency: "critical"|"high"|"normal"|"good"
- next_action: string (PT, 1 sentence, concrete — e.g. "Enviar proposta atualizada a Luís Cabral")

urgency: critical=urgent technical no reply; high=days/weeks no reply or pending; normal=stable; good=ok.
JSON only. No markdown.`

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
