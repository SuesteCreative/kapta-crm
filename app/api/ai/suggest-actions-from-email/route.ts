import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAiMemory, memorySystemBlock } from '@/lib/ai-memory'
import { requireAuth } from '@/lib/api-auth'
import { stripHtml } from '@/lib/html-utils'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SYSTEM_PROMPT = `You analyse a single email (and optional brief customer context) and propose up to 3 concrete CRM actions for Pedro (Portuguese B2B account manager at Kapta).

Action kinds:
- "follow_up": something Pedro must DO later (chase, send, verify, schedule). Has a title (PT, max 10 words, infinitive verb), description (1-2 sentences), priority, optional due_offset_days (integer, days from today).
- "ticket": a bug or product issue the client reported that engineering should fix. Has a title (PT, short), actual_behavior (PT, what client described), priority.
- "note": a relevant fact worth pinning to the customer (a constraint, a stakeholder name, a deadline). Has a title (PT, short).

Return JSON: { "suggestions": [ { "kind": "follow_up"|"ticket"|"note", ...fields } ] }

Rules:
- Inbound email asking a question/requesting something Pedro must do later → follow_up.
- Inbound email reporting a bug/error/broken feature → ticket.
- Outbound email where Pedro promised something ("vou enviar", "amanhã envio", "até sexta", "I'll send") → follow_up to track Pedro's commitment.
- Pure pleasantries (thanks, ok, confirmation) → return { "suggestions": [] }.
- Never duplicate an existing open follow-up or ticket if mentioned in customer context.
- Max 3 suggestions, the most important first.
- Priority: urgent=blocked/critical/today; high=financial/waiting days; medium=normal; low=informal.

Return ONLY valid JSON. No markdown, no explanation.`

interface SuggestRequest {
  customer_name: string
  customer_company?: string | null
  email: {
    direction: 'inbound' | 'outbound' | null
    subject: string | null
    content: string | null
    occurred_at: string
  }
  open_follow_ups?: string[]
  open_tickets?: string[]
}

export async function POST(req: Request) {
  const denied = requireAuth(req)
  if (denied) return denied
  const body = await req.json() as SuggestRequest
  const { customer_name, customer_company, email, open_follow_ups = [], open_tickets = [] } = body

  if (!email || !email.content) {
    return NextResponse.json({ ok: false, error: 'Sem email para analisar.' }, { status: 400 })
  }

  const dirLabel = email.direction === 'inbound'
    ? '← cliente'
    : email.direction === 'outbound'
      ? '→ Pedro'
      : ''

  const cleanBody = stripHtml(email.content).slice(0, 3000)
  const date = new Date(email.occurred_at).toLocaleDateString('pt-PT')

  const contextLines: string[] = []
  if (open_follow_ups.length > 0) {
    contextLines.push(`Follow-ups já abertos: ${open_follow_ups.map((t) => `"${t}"`).join(', ')}`)
  }
  if (open_tickets.length > 0) {
    contextLines.push(`Tickets já abertos: ${open_tickets.map((t) => `"${t}"`).join(', ')}`)
  }
  const contextStr = contextLines.length > 0 ? `\n\n${contextLines.join('\n')}` : ''

  const userPrompt = `Cliente: ${customer_name}${customer_company ? ` (${customer_company})` : ''}${contextStr}

Email [${date} ${dirLabel}]:
Assunto: ${email.subject ?? '(sem assunto)'}
${cleanBody}

Que ações o Pedro deve criar?`

  const memory = await getAiMemory()
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  let message
  try {
    message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: [{
        type: 'text',
        text: `${SYSTEM_PROMPT}${memorySystemBlock(memory)}`,
        cache_control: { type: 'ephemeral' },
      }],
      messages: [{ role: 'user', content: userPrompt }],
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
    const result = JSON.parse(match[0]) as { suggestions?: unknown[] }
    return NextResponse.json({ ok: true, suggestions: result.suggestions ?? [] })
  } catch {
    return NextResponse.json({ ok: false, error: 'Erro ao processar.' }, { status: 500 })
  }
}
