import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAiMemory, memorySystemBlock } from '@/lib/ai-memory'
import { buildCustomerContext } from '@/lib/customer-context'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SYSTEM_PROMPT_PT = `You are composing brand-new emails on behalf of Pedro, a Portuguese B2B account manager at Kapta.

Pedro's tone:
- Professional but warm and direct — not overly formal
- Gets to the point quickly
- Uses "Olá [Nome]," as greeting (use the recipient's first name when known; "Olá," when there are multiple recipients)
- Writes in European Portuguese (not Brazilian)
- Doesn't overuse exclamation marks
- Specific, never generic

Pedro will give you:
- A short prompt describing what he wants to communicate
- One or more recipients (with optional company / customer context)

Compose a fresh outbound email from Pedro. Return a JSON object with:
- subject: string (concise, descriptive — no "Re:" prefix; under 70 chars)
- body: string (full email body, including greeting; do NOT include any sign-off or closing)

Rules:
- Build the body from Pedro's prompt — never invent facts he didn't mention.
- When uncertain about a specific value, use "[verificar X]" as placeholder.
- Use "[NOME]" placeholder if you can't decide on a greeting (e.g. mixed recipients with no clear primary).
- When <customer_context> is present for a recipient, factor open tickets, follow-ups, and recent meetings into the email naturally — don't invent details, but acknowledge real ongoing topics.
- Keep it concise: 2-5 short paragraphs.
- Do NOT include a sign-off or signature — they will be appended automatically.

Return ONLY valid JSON. No markdown, no explanation.`

const SYSTEM_PROMPT_EN = `You are composing brand-new emails on behalf of Pedro, a Portuguese B2B account manager at Kapta.

Pedro's tone:
- Professional but warm and direct — not overly formal
- Gets to the point quickly
- Uses "Hi [Name]," as greeting (recipient's first name when known; "Hi," for multiple recipients)
- Writes in clear, natural British English
- Doesn't overuse exclamation marks
- Specific, never generic

Pedro will give you:
- A short prompt describing what he wants to communicate
- One or more recipients (with optional company / customer context)

Compose a fresh outbound email from Pedro. Return a JSON object with:
- subject: string (concise, descriptive — no "Re:" prefix; under 70 chars)
- body: string (full email body, including greeting; do NOT include any sign-off or closing)

Rules:
- Build the body from Pedro's prompt — never invent facts he didn't mention.
- When uncertain about a specific value, use "[check X]" as placeholder.
- Use "[NAME]" placeholder if you can't decide on a greeting.
- When <customer_context> is present for a recipient, factor open tickets, follow-ups, and recent meetings into the email naturally.
- Keep it concise: 2-5 short paragraphs.
- Do NOT include a sign-off or signature — they will be appended automatically.

Return ONLY valid JSON. No markdown, no explanation.`

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
