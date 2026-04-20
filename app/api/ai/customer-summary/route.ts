import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAiMemory, memorySystemBlock } from '@/lib/ai-memory'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SYSTEM_PROMPT = `CRM assistant for Pedro, Portuguese B2B account manager at Kapta. Summarize client situation.

Return JSON:
- situation: string (PT, 1-2 sentences, direct — e.g. "Kelcie reporta falhas no webhook Stripe há 3 dias, aguarda resposta.")
- urgency: "critical"|"high"|"normal"|"good"
- next_action: string (PT, 1 sentence, concrete action — e.g. "Responder ao email sobre webhook Stripe")

urgency: critical=urgent technical/financial no reply; high=days no reply or pending; normal=stable; good=all ok.
next_action must be specific, not "acompanhar cliente". JSON only. No markdown.`

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

  const memory = await getAiMemory()

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  let message
  try {
    message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: [{ type: 'text', text: `${SYSTEM_PROMPT}${memorySystemBlock(memory)}`, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Claude API error:', msg)
    return NextResponse.json({ ok: false, error: `Claude error: ${msg}` }, { status: 500 })
  }

  const rawText = message.content[0].type === 'text' ? message.content[0].text : ''
  const match = rawText.match(/\{[\s\S]*\}/)
  if (!match) {
    console.error('Claude non-JSON response:', rawText.slice(0, 200))
    return NextResponse.json({ ok: false, error: 'Claude returned unexpected format' }, { status: 500 })
  }

  try {
    const result = JSON.parse(match[0])
    return NextResponse.json({ ok: true, ...result })
  } catch {
    return NextResponse.json({ ok: false, error: 'Erro ao processar.' }, { status: 500 })
  }
}
