import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAiMemory, memorySystemBlock } from '@/lib/ai-memory'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SYSTEM_PROMPT = `Write a resolution email on behalf of Pedro, Portuguese B2B account manager at Kapta.

Given a support ticket that was just resolved, write a clear, professional email to the client.

Return JSON:
- subject: string (PT — "Resolução: [issue title]" or similar)
- body: string (PT — full body, NO greeting, NO sign-off — those are added automatically)

Rules:
- Confirm the issue was resolved
- Briefly explain what was done (use ticket data; use "[verificar com equipa]" if unsure of specifics)
- Invite them to reply if the problem persists
- European Portuguese, warm but direct — 2-3 short paragraphs max
- Do NOT include "Olá [Nome]," or sign-off — those are added by the system
JSON only. No markdown.`

type ResolutionRequest = {
  customer_name: string
  customer_company: string | null
  ticket: {
    title: string
    description: string | null
    actual_behavior: string | null
    expected_behavior: string | null
    steps_to_reproduce: string | null
    tags: string[]
  }
}

export async function POST(req: Request) {
  const { customer_name, customer_company, ticket } = await req.json() as ResolutionRequest

  const ticketSummary = [
    `Título: ${ticket.title}`,
    ticket.description ? `Descrição: ${ticket.description}` : null,
    ticket.actual_behavior ? `Comportamento reportado: ${ticket.actual_behavior}` : null,
    ticket.expected_behavior ? `Comportamento esperado: ${ticket.expected_behavior}` : null,
    ticket.tags.length ? `Tags: ${ticket.tags.join(', ')}` : null,
  ].filter(Boolean).join('\n')

  const memory = await getAiMemory()

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  let message
  try {
    message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: [{ type: 'text', text: `${SYSTEM_PROMPT}${memorySystemBlock(memory)}`, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Cliente: ${customer_name}${customer_company ? ` (${customer_company})` : ''}\n\nTicket resolvido:\n${ticketSummary}\n\nEscreve o email de resolução.`,
      }],
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
