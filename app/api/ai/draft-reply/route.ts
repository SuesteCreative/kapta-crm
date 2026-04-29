import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAiMemory, memorySystemBlock } from '@/lib/ai-memory'
import { buildCustomerContext } from '@/lib/customer-context'
import { stripHtml } from '@/lib/html-utils'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM_PROMPT_PT = `Write email reply for Pedro (Kapta, B2B account manager, PT).

Tone: professional, warm, direct. Not formal. Concise. European Portuguese.
Greeting: "Olá [Nome],". Sign-off: appended downstream — DO NOT write closing.

Reply rules:
- Question asked → answer clearly.
- Problem reported → acknowledge + state what Pedro will do.
- Pedro promised something + late → apologise + give timeline.
- 3-5 short paragraphs max. No filler. No exclamation marks unless tone demands.
- Never invent facts. Uncertain value → "[verificar X]".
- <customer_context> present → reference open tickets / follow-ups / recent meetings if relevant. Don't pretend issues don't exist.

Output JSON:
{ "subject": "Re: ...", "body": "..." }
- subject: keep original "Re: ..." or minor tweak.
- body: greeting + content. NO sign-off.

Return ONLY JSON. No markdown. No explanation.`

const SYSTEM_PROMPT_EN = `Write email reply for Pedro (Kapta, B2B account manager).

Tone: professional, warm, direct. Not formal. Concise. Clear British English.
Greeting: "Hi [Name],". Sign-off: appended downstream — DO NOT write closing.

Reply rules:
- Question asked → answer clearly.
- Problem reported → acknowledge + state what Pedro will do.
- Pedro promised something + late → apologise + give timeline.
- 3-5 short paragraphs max. No filler. No exclamation marks unless tone demands.
- Never invent facts. Uncertain value → "[check X]".
- <customer_context> present → reference open tickets / follow-ups / recent meetings if relevant. Don't pretend issues don't exist.

Output JSON:
{ "subject": "Re: ...", "body": "..." }
- subject: keep original "Re: ..." or minor tweak.
- body: greeting + content. NO sign-off.

Return ONLY JSON. No markdown. No explanation.`

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
