import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAiMemory, memorySystemBlock } from '@/lib/ai-memory'
import { requireAuth } from '@/lib/api-auth'
import { stripHtml } from '@/lib/html-utils'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SYSTEM_PROMPT = `Analyse one email + optional customer context. Propose ≤3 CRM actions for Pedro (Kapta, B2B account manager, PT).

Action kinds:
- "follow_up": Pedro must DO later. Fields: title (PT, ≤10 words, infinitive verb), description (1-2 sentences PT), priority, optional due_offset_days (int, days from today).
- "ticket": client-reported bug / product issue. Fields: title (PT, short), actual_behavior (PT), priority.
- "note": fact worth pinning (constraint, stakeholder, deadline). Fields: title (PT, short).

Routing:
- Inbound asking / requesting something → follow_up.
- Inbound reporting bug/error/broken → ticket.
- Outbound where Pedro promised ("vou enviar", "amanhã envio", "até sexta", "I'll send") → follow_up to track commitment.
- Pure pleasantries (thanks, ok, confirm) → { "suggestions": [] }.

Rules:
- Don't duplicate items already in customer context's open lists.
- Most important first.
- Priority: urgent=blocked/critical/today; high=financial/waiting days; medium=normal; low=informal.

Output: { "suggestions": [{ "kind": "follow_up"|"ticket"|"note", ...fields }] }
Return ONLY JSON. No markdown. No explanation.`

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
