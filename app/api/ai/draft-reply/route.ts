import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAiMemory, memorySystemBlock } from '@/lib/ai-memory'
import { buildCustomerContext } from '@/lib/customer-context'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SYSTEM_PROMPT_PT = `You are writing email replies on behalf of Pedro, a Portuguese B2B account manager at Kapta.

Pedro's tone:
- Professional but warm and direct — not overly formal
- Gets to the point quickly
- Uses "Olá [Nome]," as greeting and "Com os melhores cumprimentos,\nPedro" as sign-off
- Writes in European Portuguese (not Brazilian)
- Doesn't overuse exclamation marks
- Addresses the specific question or issue raised — doesn't write generic replies

Given the email conversation thread (oldest to newest), write a reply to the most recent inbound message.

Return a JSON object with:
- subject: string (keep "Re: [original subject]" or slightly adjusted — never change it drastically)
- body: string (the full email body, including greeting and sign-off)

Rules:
- If the client asked a question, answer it clearly
- If the client reported a problem, acknowledge it and say what Pedro will do
- If the client is waiting for something Pedro promised, apologize for the delay and give a timeline
- Never invent specific facts Pedro doesn't know — use "[verificar X]" as placeholder when uncertain
- Keep it concise — 3-5 short paragraphs max
- When a <customer_context> block is provided, factor open tickets, follow-ups, and recent meetings/WhatsApp into the reply. If the client's question relates to an open ticket, acknowledge it explicitly. Don't pretend the open issue doesn't exist.

Return ONLY valid JSON, no markdown, no explanation.`

const SYSTEM_PROMPT_EN = `You are writing email replies on behalf of Pedro, a Portuguese B2B account manager at Kapta.

Pedro's tone:
- Professional but warm and direct — not overly formal
- Gets to the point quickly
- Uses "Hi [Name]," as greeting and "Best regards,\nPedro" as sign-off
- Writes in clear, natural British English
- Doesn't overuse exclamation marks
- Addresses the specific question or issue raised — doesn't write generic replies

Given the email conversation thread (oldest to newest), write a reply to the most recent inbound message.

Return a JSON object with:
- subject: string (keep "Re: [original subject]" or slightly adjusted — never change it drastically)
- body: string (the full email body, including greeting and sign-off)

Rules:
- If the client asked a question, answer it clearly
- If the client reported a problem, acknowledge it and say what Pedro will do
- If the client is waiting for something Pedro promised, apologize for the delay and give a timeline
- Never invent specific facts Pedro doesn't know — use "[check X]" as placeholder when uncertain
- Keep it concise — 3-5 short paragraphs max
- When a <customer_context> block is provided, factor open tickets, follow-ups, and recent meetings/WhatsApp into the reply. If the client's question relates to an open ticket, acknowledge it explicitly. Don't pretend the open issue doesn't exist.

Return ONLY valid JSON, no markdown, no explanation.`

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

type AttachmentMeta = { name: string; ai_summary?: string; mime?: string }

function withAttachments(text: string, metadata: Record<string, unknown> | null | undefined): string {
  const atts = (metadata?.attachments as AttachmentMeta[] | undefined) ?? []
  if (atts.length === 0) return text
  const attLine = atts.map((a) => `${a.name}: ${a.ai_summary ?? a.mime ?? a.name}`).join(' | ')
  return `${text}\n[Attachments: ${attLine}]`
}

type DraftRequest = {
  customer_id?: string
  customer_name: string
  customer_company: string | null
  language?: 'pt-PT' | 'en'
  interactions: Array<{
    type: string
    direction: string | null
    subject: string | null
    content: string | null
    occurred_at: string
    metadata?: Record<string, unknown> | null
  }>
}

export async function POST(req: Request) {
  const body = await req.json() as DraftRequest
  const { customer_id, customer_name, customer_company, interactions, language = 'pt-PT' } = body

  if (!interactions || interactions.length === 0) {
    return NextResponse.json({ ok: false, error: 'Sem interações para analisar.' }, { status: 400 })
  }

  const customerContext = customer_id ? await buildCustomerContext(customer_id, language) : null

  // Build thread oldest → newest, max 6 emails
  const emailThread = interactions
    .filter((i) => i.type === 'email')
    .slice(0, 6)
    .reverse()
    .map((i) => {
      const who = i.direction === 'inbound'
        ? `${customer_name}${customer_company ? ` (${customer_company})` : ''}`
        : 'Pedro (eu)'
      const text = withAttachments(
        i.content ? stripHtml(i.content).slice(0, 4000) : '(sem conteúdo)',
        i.metadata
      )
      return `[${new Date(i.occurred_at).toLocaleDateString('pt-PT')} — ${who}]
Assunto: ${i.subject ?? '(sem assunto)'}
${text}`
    })
    .join('\n\n---\n\n')

  // Last subject for Re: prefix
  const lastSubject = interactions.find((i) => i.subject)?.subject ?? ''

  const basePrompt = language === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_PT
  // Sign-off is appended by the send route as an HTML signature — do not include it in the body
  const signoffInstruction = `Do NOT include a sign-off or closing at the end of the body. End the email after the last sentence of content. The signature will be added automatically.`

  const memory = await getAiMemory()

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: `${basePrompt}\n\n${signoffInstruction}${memorySystemBlock(memory)}`,
      cache_control: { type: 'ephemeral' },
    },
  ]
  if (customerContext) {
    systemBlocks.push({
      type: 'text',
      text: customerContext,
      cache_control: { type: 'ephemeral' },
    })
  }

  let message
  try {
    message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemBlocks,
      messages: [{
        role: 'user',
        content: `Write a reply to this email thread. The last message is from ${customer_name} and needs a response.\n\nThread:\n\n${emailThread}\n\nUse "Re: ${lastSubject}" as subject (or adjust slightly if needed).`,
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
    return NextResponse.json({ ok: false, error: 'Claude returned invalid JSON' }, { status: 500 })
  }
}
