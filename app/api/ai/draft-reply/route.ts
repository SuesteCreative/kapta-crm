import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAiMemory, memorySystemBlock } from '@/lib/ai-memory'
import { buildCustomerContext } from '@/lib/customer-context'
import { stripHtml } from '@/lib/html-utils'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM_PROMPT_PT = `Write email reply for Pedro (Kapta, B2B account manager, PT). Output in European Portuguese.

INSTRUCTION-FIRST: If <INSTRUCTION> block in user message, that is canonical brief for THIS email. Cover every point in it. Thread is reference only. Do NOT substitute generic follow-up text. Do NOT skip instruction items.

Tone: pro, warm, direct. Not formal. Concise.
Greeting: "Olá [Nome],". No sign-off (added downstream).

Rules:
- Question → answer.
- Problem → acknowledge + state action.
- Promise late → apologise + timeline.
- Max 3-5 short paragraphs. Zero filler. No "!" unless tone needs.
- Never invent. Unsure → "[verificar X]".
- <customer_context> → reference open tickets/follow-ups if relevant.

Output JSON only, no markdown:
{ "subject": "Re: ...", "body": "Olá...\\n\\n..." }`

const SYSTEM_PROMPT_EN = `Write email reply for Pedro (Kapta, B2B account manager). Output in British English.

INSTRUCTION-FIRST: If <INSTRUCTION> block in user message, that is canonical brief for THIS email. Cover every point in it. Thread is reference only. Do NOT substitute generic follow-up text. Do NOT skip instruction items.

Tone: pro, warm, direct. Not formal. Concise.
Greeting: "Hi [Name],". No sign-off (added downstream).

Rules:
- Question → answer.
- Problem → acknowledge + state action.
- Promise late → apologise + timeline.
- Max 3-5 short paragraphs. Zero filler. No "!" unless tone needs.
- Never invent. Unsure → "[check X]".
- <customer_context> → reference open tickets/follow-ups if relevant.

Output JSON only, no markdown:
{ "subject": "Re: ...", "body": "Hi...\\n\\n..." }`

const SYSTEM_PROMPT_ES = `Write email reply for Pedro (Kapta, B2B account manager, Spain market). Output in European Spanish (Castellano).

INSTRUCTION-FIRST: If <INSTRUCTION> block in user message, that is canonical brief for THIS email. Cover every point in it. Thread is reference only. Do NOT substitute generic follow-up text. Do NOT skip instruction items.

Tone: pro, warm, direct. Not formal. Concise.
Greeting: "Hola [Nombre],". No sign-off (added downstream).

Rules:
- Question → answer.
- Problem → acknowledge + state action.
- Promise late → apologise + timeline.
- Max 3-5 short paragraphs. Zero filler. No "!" unless tone needs.
- Never invent. Unsure → "[verificar X]".
- <customer_context> → reference open tickets/follow-ups if relevant.

Output JSON only, no markdown:
{ "subject": "Re: ...", "body": "Hola...\\n\\n..." }`

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
  language?: 'pt-PT' | 'en' | 'es'
  user_instruction?: string | null
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
  try {
    return await handle(req)
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}${err.stack ? ` :: ${err.stack.split('\n').slice(1, 3).join(' | ')}` : ''}` : String(err)
    console.error('draft-reply outer error:', msg)
    return NextResponse.json({ ok: false, error: `Server error: ${msg.slice(0, 300)}` }, { status: 500 })
  }
}

async function handle(req: Request) {
  const body = await req.json() as DraftRequest
  const { customer_id, customer_name, customer_company, interactions, language = 'pt-PT', user_instruction } = body

  if (!interactions || interactions.length === 0) {
    return NextResponse.json({ ok: false, error: 'Sem interações para analisar.' }, { status: 400 })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: false, error: 'ANTHROPIC_API_KEY missing on server' }, { status: 500 })
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, error: 'Supabase env missing on server' }, { status: 500 })
  }

  let customerContext: string | null = null
  try {
    customerContext = customer_id ? await buildCustomerContext(customer_id, language) : null
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('buildCustomerContext failed:', msg)
    // Don't fail the whole request — drafting can proceed without customer context
    customerContext = null
  }

  // When user gave a specific instruction, trim thread to last 5 emails (instruction is canonical,
  // long thread dilutes attention). Without instruction, keep 30 emails for context recovery.
  const hasInstruction = !!user_instruction?.trim()
  const threadLimit = hasInstruction ? 5 : 30
  const emailThread = interactions
    .filter((i) => i.type === 'email')
    .slice(0, threadLimit)
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

  const basePrompt =
    language === 'en' ? SYSTEM_PROMPT_EN :
    language === 'es' ? SYSTEM_PROMPT_ES :
    SYSTEM_PROMPT_PT
  // Sign-off is appended by the send route as an HTML signature — do not include it in the body
  const signoffInstruction = `Do NOT include a sign-off or closing at the end of the body. End the email after the last sentence of content. The signature will be added automatically.`

  let memory: string | null = null
  try {
    memory = await getAiMemory()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('getAiMemory failed:', msg)
  }

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

  // Put INSTRUCTION block at the TOP of the user message so Sonnet anchors on it,
  // not on the thread. Wrap in explicit markers so the system prompt's INSTRUCTION-FIRST
  // rule fires reliably.
  const userMessage = hasInstruction
    ? [
        `<INSTRUCTION>`,
        user_instruction!.trim(),
        `</INSTRUCTION>`,
        ``,
        `Write Pedro's reply NOW based on the INSTRUCTION above. Cover every point.`,
        `Last message in thread is from ${customer_name}. Use "Re: ${lastSubject}" as subject (or minor tweak).`,
        ``,
        `Thread (reference, oldest → newest):`,
        ``,
        emailThread,
      ].join('\n')
    : [
        `Write a reply to this email thread. The last message is from ${customer_name} and needs a response.`,
        ``,
        `Thread (oldest → newest — read all messages before replying):`,
        ``,
        emailThread,
        ``,
        `Use "Re: ${lastSubject}" as subject (or adjust slightly if needed).`,
      ].join('\n')

  let message
  try {
    message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemBlocks,
      messages: [{ role: 'user', content: userMessage }],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Claude API error:', msg)
    return NextResponse.json({ ok: false, error: `Claude error: ${msg}` }, { status: 500 })
  }

  // Find first text block — model may return thinking/other blocks before text
  const textBlock = message.content?.find((b) => b.type === 'text')
  const rawText = textBlock?.type === 'text' ? textBlock.text : ''
  if (!rawText) {
    console.error('Claude empty/non-text response. stop_reason=', message.stop_reason, 'content=', JSON.stringify(message.content).slice(0, 300))
    return NextResponse.json({
      ok: false,
      error: `Claude empty response (stop_reason=${message.stop_reason ?? 'unknown'})`,
    }, { status: 500 })
  }
  const match = rawText.match(/\{[\s\S]*\}/)
  if (!match) {
    console.error('Claude non-JSON response:', rawText.slice(0, 200))
    return NextResponse.json({ ok: false, error: `Claude returned unexpected format: ${rawText.slice(0, 120)}` }, { status: 500 })
  }

  try {
    const result = JSON.parse(match[0])
    return NextResponse.json({ ok: true, ...result })
  } catch {
    return NextResponse.json({ ok: false, error: 'Claude returned invalid JSON' }, { status: 500 })
  }
}
