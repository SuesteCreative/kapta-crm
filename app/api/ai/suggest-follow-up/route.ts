import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAiMemory, memorySystemBlock } from '@/lib/ai-memory'
import { stripHtml } from '@/lib/html-utils'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SYSTEM_PROMPT = `Suggest follow-up for Pedro (Portuguese B2B account manager, Kapta) based on client interactions.

Return JSON:
- title: string (PT, max 10 words, infinitive verb — e.g. "Enviar proposta de preços atualizada")
- description: string (PT, 1-2 sentences — what's pending and why)
- priority: "low"|"medium"|"high"|"urgent"

Priority: urgent=blocked/critical/due today-tomorrow; high=pending days/financial/waiting; medium=natural next step; low=informal.
JSON only. No markdown.`

interface RequestBody {
  customer_name: string
  customer_company?: string | null
  interactions: Array<{ type: string; direction: string | null; subject: string | null; content: string | null; occurred_at: string }>
  user_prompt?: string
  current?: { title?: string; description?: string; priority?: string }
}

export async function POST(req: Request) {
  const { customer_name, customer_company, interactions, user_prompt, current } = await req.json() as RequestBody

  if (!interactions?.length) {
    return NextResponse.json({ ok: false, error: 'Sem interações.' }, { status: 400 })
  }

  const recent = interactions.slice(0, 8)
  const text = recent.map((i) => {
    const dir = i.direction === 'inbound' ? '← cliente' : i.direction === 'outbound' ? '→ Pedro' : ''
    const content = i.content ? stripHtml(i.content).slice(0, 400) : '(sem conteúdo)'
    return `[${new Date(i.occurred_at).toLocaleDateString('pt-PT')} ${i.type} ${dir}] ${i.subject ? `${i.subject} — ` : ''}${content}`
  }).join('\n\n')

  const refining = !!(user_prompt?.trim())

  const currentBlock = refining && current && (current.title || current.description)
    ? `\nVersão atual:\nTítulo: ${current.title ?? '—'}\nDescrição: ${current.description ?? '—'}\nPrioridade: ${current.priority ?? 'medium'}\n`
    : ''

  const instructionBlock = refining
    ? `\nPedro pediu este ajuste: "${user_prompt!.trim()}"\nReescreve o follow-up respeitando esse pedido. Mantém JSON.`
    : 'Qual o follow-up mais importante que Pedro deve criar?'

  const prompt = `Cliente: ${customer_name}${customer_company ? ` (${customer_company})` : ''}

Interações recentes:
${text}
${currentBlock}
${instructionBlock}`

  const memory = await getAiMemory()

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  let message
  try {
    message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: [{ type: 'text', text: `${SYSTEM_PROMPT}${memorySystemBlock(memory)}`, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
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
