import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAiMemory, memorySystemBlock } from '@/lib/ai-memory'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SYSTEM_PROMPT = `Create support ticket from client email thread. Pedro = Portuguese B2B account manager at Kapta.

Read the FULL thread (oldest → newest) before answering. Platform names, account IDs, and reproduction steps may appear in older messages or attachments — do not ignore them.

Kapta products (= "platform"): rioko, stripe_app, konnector.
Input platforms (data source): stripe, fareharbor, shopify, easypay, eupago, outro.
Output platforms (invoicing): invoicexpress, moloni, vendus, billin, holded, sage, outro.

Konnector connects an input platform to an output platform. If the thread mentions both an input and an output, platform = "konnector".

Return JSON:
- title: string (PT, max 10 words, infinitive verb)
- description: string (PT, 2-4 sentences, what client reported)
- steps_to_reproduce: string|null
- expected_behavior: string|null
- actual_behavior: string|null
- priority: "low"|"medium"|"high"|"urgent"
- tags: string[] (2-4, PT, lowercase)
- platform: "rioko"|"stripe_app"|"konnector"|null
- input_platform: "stripe"|"fareharbor"|"shopify"|"easypay"|"eupago"|"outro"|null
- output_platform: "invoicexpress"|"moloni"|"vendus"|"billin"|"holded"|"sage"|"outro"|null
- account_number: string|null  (acct_xxx, cus_xxx, client account ID — only if explicitly stated)
- references: string[]  (Stripe IDs pi_/ch_/cs_/in_, Eupago refs, FH-xxx, etc.)

Priority: urgent=down/data loss/billing/churn threat; high=broken/blocking/>5d wait; medium=unexpected behavior; low=minor/feature request.
Use null when value is not in the thread. Do not invent. JSON only. No markdown.`

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

type AttachmentMeta = { name: string; ai_summary?: string }

function withAttachments(text: string, metadata: Record<string, unknown> | null | undefined): string {
  const atts = (metadata?.attachments as AttachmentMeta[] | undefined) ?? []
  if (atts.length === 0) return text
  return `${text}\n[Attachments: ${atts.map((a) => `${a.name}: ${a.ai_summary ?? a.name}`).join(' | ')}]`
}

type SuggestRequest = {
  customer_name: string
  customer_company: string | null
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
  const body = await req.json() as SuggestRequest

  const { customer_name, customer_company, interactions, user_instruction } = body

  if (!interactions || interactions.length === 0) {
    return NextResponse.json({ ok: false, error: 'Sem interações para analisar.' }, { status: 400 })
  }

  // Build conversation oldest → newest so AI sees how the issue evolved
  // (platform/account refs often appear in earlier messages).
  const thread = interactions
    .filter((i) => i.type === 'email')
    .slice(0, 20)
    .reverse()
    .map((i) => {
      const direction = i.direction === 'inbound' ? `${customer_name} escreveu` : 'Pedro respondeu'
      const body = withAttachments(
        i.content ? stripHtml(i.content).slice(0, 2000) : '(sem conteúdo)',
        i.metadata
      )
      return `[${new Date(i.occurred_at).toLocaleDateString('pt-PT')} — ${direction}]
Assunto: ${i.subject ?? '(sem assunto)'}
${body}`
    }).join('\n\n---\n\n')

  const memory = await getAiMemory()

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  let message
  try {
    message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: [{ type: 'text', text: `${SYSTEM_PROMPT}${memorySystemBlock(memory)}`, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: [
          `Customer: ${customer_name}${customer_company ? ` (${customer_company})` : ''}`,
          user_instruction?.trim()
            ? `\n\nPedro's instructions for THIS ticket (override defaults if conflict):\n${user_instruction.trim()}`
            : '',
          `\n\nConversation (oldest → newest, read all):\n\n${thread}`,
        ].join(''),
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
