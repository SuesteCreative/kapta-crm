import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAiMemory, memorySystemBlock } from '@/lib/ai-memory'
import { buildCustomerContext } from '@/lib/customer-context'
import { requireAuth } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SYSTEM_PROMPT_PT = `Compose new email for Pedro (Kapta, B2B account manager, PT).

Tone: professional, warm, direct. Not formal. Specific, never generic. European Portuguese.
Greeting: "Olá [Nome]," (first name if known); "Olá," for multiple recipients; "[NOME]" if undecidable.
Sign-off: appended downstream — DO NOT write closing.

Input: Pedro's brief + recipient list (+ optional <customer_context>).

Rules:
- Build body from Pedro's brief. Never invent facts.
- Uncertain value → "[verificar X]".
- <customer_context> present → reference open tickets / follow-ups / recent meetings naturally. Don't invent details.
- 2-5 short paragraphs. No filler.

Output JSON:
{ "subject": "...", "body": "..." }
- subject: concise, descriptive, no "Re:" prefix, <70 chars.
- body: greeting + content. NO sign-off.

Return ONLY JSON. No markdown. No explanation.`

const SYSTEM_PROMPT_EN = `Compose new email for Pedro (Kapta, B2B account manager).

Tone: professional, warm, direct. Not formal. Specific, never generic. Clear British English.
Greeting: "Hi [Name]," (first name if known); "Hi," for multiple recipients; "[NAME]" if undecidable.
Sign-off: appended downstream — DO NOT write closing.

Input: Pedro's brief + recipient list (+ optional <customer_context>).

Rules:
- Build body from Pedro's brief. Never invent facts.
- Uncertain value → "[check X]".
- <customer_context> present → reference open tickets / follow-ups / recent meetings naturally.
- 2-5 short paragraphs. No filler.

Output JSON:
{ "subject": "...", "body": "..." }
- subject: concise, descriptive, no "Re:" prefix, <70 chars.
- body: greeting + content. NO sign-off.

Return ONLY JSON. No markdown. No explanation.`

interface RecipientInput {
  email: string
  name?: string
  company?: string | null
  customer_id?: string | null
}

interface ComposeRequest {
  prompt: string
  language?: 'pt-PT' | 'en'
  recipients: RecipientInput[]
}

export async function POST(req: Request) {
  const denied = requireAuth(req)
  if (denied) return denied
  let data: ComposeRequest
  try {
    data = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const { prompt, language = 'pt-PT', recipients } = data

  if (!prompt || prompt.trim().length < 3) {
    return NextResponse.json({ ok: false, error: 'prompt obrigatório' }, { status: 400 })
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return NextResponse.json({ ok: false, error: 'pelo menos um destinatário' }, { status: 400 })
  }

  // Build context block per known customer (max 3 to keep prompt small)
  const customerIds = recipients
    .map((r) => r.customer_id)
    .filter((id): id is string => Boolean(id))
    .slice(0, 3)

  const contextBlocks = await Promise.all(
    customerIds.map((id) => buildCustomerContext(id, language)),
  )

  const recipientLines = recipients.map((r) => {
    const parts: string[] = [r.email]
    if (r.name) parts.push(`name: ${r.name}`)
    if (r.company) parts.push(`company: ${r.company}`)
    return `- ${parts.join(' · ')}`
  }).join('\n')

  const contextText = contextBlocks
    .filter((c): c is string => Boolean(c))
    .join('\n\n')

  const userMessage = [
    `Pedro wants to send a fresh email to these recipients:`,
    recipientLines,
    contextText ? `\nKnown customer context:\n${contextText}` : '',
    `\nPedro's brief:`,
    prompt.trim(),
    `\nWrite the email now.`,
  ].filter(Boolean).join('\n')

  const memory = await getAiMemory()
  const basePrompt = language === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_PT

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  let message
  try {
    message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: [{
        type: 'text',
        text: `${basePrompt}${memorySystemBlock(memory)}`,
        cache_control: { type: 'ephemeral' },
      }],
      messages: [{ role: 'user', content: userMessage }],
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
    const result = JSON.parse(match[0]) as { subject?: string; body?: string }
    return NextResponse.json({
      ok: true,
      subject: result.subject ?? '',
      body: result.body ?? '',
    })
  } catch {
    return NextResponse.json({ ok: false, error: 'Claude returned invalid JSON' }, { status: 500 })
  }
}
