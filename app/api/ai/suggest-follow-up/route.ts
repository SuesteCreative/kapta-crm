import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SYSTEM_PROMPT = `Suggest follow-up for Pedro (Portuguese B2B account manager, Kapta) based on client interactions.

Return JSON:
- title: string (PT, max 10 words, infinitive verb — e.g. "Enviar proposta de preços atualizada")
- description: string (PT, 1-2 sentences — what's pending and why)
- priority: "low"|"medium"|"high"|"urgent"

Priority: urgent=blocked/critical/due today-tomorrow; high=pending days/financial/waiting; medium=natural next step; low=informal.
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

export async function POST(req: Request) {
  const { customer_name, customer_company, interactions } = await req.json()

  if (!interactions?.length) {
    return NextResponse.json({ ok: false, error: 'Sem interações.' }, { status: 400 })
  }

  const recent = interactions.slice(0, 8)
  const text = recent.map((i: { type: string; direction: string | null; subject: string | null; content: string | null; occurred_at: string }) => {
    const dir = i.direction === 'inbound' ? '← cliente' : i.direction === 'outbound' ? '→ Pedro' : ''
    const content = i.content ? stripHtml(i.content).slice(0, 400) : '(sem conteúdo)'
    return `[${new Date(i.occurred_at).toLocaleDateString('pt-PT')} ${i.type} ${dir}] ${i.subject ? `${i.subject} — ` : ''}${content}`
  }).join('\n\n')

  const prompt = `Cliente: ${customer_name}${customer_company ? ` (${customer_company})` : ''}

Interações recentes:
${text}

Qual o follow-up mais importante que Pedro deve criar?`

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }],
  })

  const rawText = message.content[0].type === 'text' ? message.content[0].text : ''
  const match = rawText.match(/\{[\s\S]*\}/)
  try {
    const result = JSON.parse(match?.[0] ?? '{}')
    return NextResponse.json({ ok: true, ...result })
  } catch {
    return NextResponse.json({ ok: false, error: 'Erro ao processar.' }, { status: 500 })
  }
}
