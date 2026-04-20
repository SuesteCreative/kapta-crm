import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase'
import { getAiMemory, memorySystemBlock } from '@/lib/ai-memory'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM_PROMPT = `Group client messages (email/WhatsApp) from Kapta (Portuguese B2B) by common problem.

Focus on technical issues, complaints, support requests. Ignore pleasantries/thanks.

Return JSON array. Each item:
- issue_title: string (PT, max 8 words)
- issue_description: string (PT, 2-3 sentences)
- customer_ids: string[]
- example_summary: string (PT, 1 sentence, most representative case)

Rules: cluster only if same clear problem; min 2 customers per cluster; omit singletons.
If no cluster has ≥2 customers, return []. JSON array only. No markdown.`

type ClusterResult = {
  issue_title: string
  issue_description: string
  customer_ids: string[]
  example_summary: string
}

export type EnrichedCluster = ClusterResult & {
  customers: Array<{ id: string; name: string; company: string | null }>
}

export async function POST() {
  const supabase = createServiceClient()

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  // Inbound emails + WhatsApp only (raw client voice, not summaries)
  const { data: allMessages } = await supabase
    .from('interactions')
    .select('id, customer_id, type, subject, content, occurred_at, customers(id, name, company)')
    .gte('occurred_at', since)
    .eq('direction', 'inbound')
    .in('type', ['email', 'whatsapp'])
    .order('occurred_at', { ascending: false })
    .limit(200)

  if (!allMessages || allMessages.length === 0) {
    return NextResponse.json({ ok: true, clusters: [], scanned: 0, message: 'Sem mensagens para analisar.' })
  }

  // Dedup: 1 per customer, filter out no-content
  const byCustomer = new Map<string, typeof allMessages[0]>()
  for (const m of allMessages) {
    if (!byCustomer.has(m.customer_id) && m.content && m.content.trim().length > 10) {
      byCustomer.set(m.customer_id, m)
    }
  }

  const batch = [...byCustomer.values()].slice(0, 50)

  if (batch.length < 2) {
    return NextResponse.json({ ok: true, clusters: [], scanned: batch.length, message: 'Mensagens insuficientes para agrupar.' })
  }

  // Build Claude input
  const itemsText = batch.map((m) => {
    const customer = Array.isArray(m.customers) ? m.customers[0] : m.customers
    const name = customer ? `${customer.name}${customer.company ? ` (${customer.company})` : ''}` : 'Desconhecido'
    const body = (m.content ?? '').slice(0, 500)
    return JSON.stringify({
      customer_id: m.customer_id,
      channel: m.type,
      from: name,
      subject: m.subject ?? null,
      date: m.occurred_at,
      message: body,
    })
  }).join('\n')

  const memory = await getAiMemory()

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  let message
  try {
    message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: [{ type: 'text', text: `${SYSTEM_PROMPT}${memorySystemBlock(memory)}`, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Group by common issue:\n\n${itemsText}` }],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Claude API error:', msg)
    return NextResponse.json({ ok: false, error: `Claude error: ${msg}` }, { status: 500 })
  }

  const rawText = message.content[0].type === 'text' ? message.content[0].text : ''
  const match = rawText.match(/\[[\s\S]*\]/)
  if (!match) {
    console.error('Claude non-JSON response:', rawText.slice(0, 200))
    return NextResponse.json({ ok: false, error: 'Claude returned unexpected format' }, { status: 500 })
  }
  let clusterResults: ClusterResult[] = []
  try {
    clusterResults = JSON.parse(match[0])
  } catch {
    return NextResponse.json({ ok: false, error: 'Claude devolveu JSON inválido' }, { status: 500 })
  }

  // Build customer lookup from batch
  const customerMap = new Map<string, { id: string; name: string; company: string | null }>()
  for (const m of batch) {
    const c = Array.isArray(m.customers) ? m.customers[0] : m.customers
    if (c) customerMap.set(m.customer_id, c)
  }

  // Enrich clusters with customer objects, filter to ≥2
  const clusters: EnrichedCluster[] = clusterResults
    .filter((c) => c.customer_ids.length >= 2)
    .map((c) => ({
      ...c,
      customers: c.customer_ids
        .map((id) => customerMap.get(id))
        .filter((c): c is NonNullable<typeof c> => c !== undefined),
    }))

  return NextResponse.json({ ok: true, clusters, scanned: batch.length })
}
