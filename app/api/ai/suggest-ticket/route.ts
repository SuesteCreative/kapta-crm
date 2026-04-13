import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SYSTEM_PROMPT = `Create support ticket from client email thread. Pedro = Portuguese B2B account manager at Kapta.

Return JSON:
- title: string (PT, max 10 words, infinitive verb)
- description: string (PT, 2-4 sentences, what client reported)
- steps_to_reproduce: string|null
- expected_behavior: string|null
- actual_behavior: string|null
- priority: "low"|"medium"|"high"|"urgent"
- tags: string[] (2-4, PT, lowercase)

Priority: urgent=down/data loss/billing/churn threat; high=broken/blocking/>5d wait; medium=unexpected behavior; low=minor/feature request.
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

type SuggestRequest = {
  customer_name: string
  customer_company: string | null
  interactions: Array<{
    type: string
    direction: string | null
    subject: string | null
    content: string | null
    occurred_at: string
  }>
}

export async function POST(req: Request) {
  const body = await req.json() as SuggestRequest

  const { customer_name, customer_company, interactions } = body

  if (!interactions || interactions.length === 0) {
    return NextResponse.json({ ok: false, error: 'Sem interações para analisar.' }, { status: 400 })
  }

  // Build conversation thread — most relevant first
  const thread = interactions.slice(0, 8).map((i) => {
    const direction = i.direction === 'inbound' ? `${customer_name} escreveu` : 'Pedro respondeu'
    const body = i.content ? stripHtml(i.content).slice(0, 500) : '(sem conteúdo)'
    return `[${new Date(i.occurred_at).toLocaleDateString('pt-PT')} — ${direction}]
Assunto: ${i.subject ?? '(sem assunto)'}
${body}`
  }).join('\n\n---\n\n')

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: `Customer: ${customer_name}${customer_company ? ` (${customer_company})` : ''}\n\nConversation:\n\n${thread}`,
    }],
  })

  const rawText = message.content[0].type === 'text' ? message.content[0].text : ''
  const match = rawText.match(/\{[\s\S]*\}/)
  const raw = match ? match[0] : '{}'

  try {
    const result = JSON.parse(raw)
    return NextResponse.json({ ok: true, ...result })
  } catch {
    return NextResponse.json({ ok: false, error: 'Claude returned invalid JSON', raw }, { status: 500 })
  }
}
