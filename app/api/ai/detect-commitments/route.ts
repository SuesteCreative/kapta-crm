import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase'
import { getAiMemory, memorySystemBlock } from '@/lib/ai-memory'
import { requireAuth } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM_PROMPT = `Find Pedro's commitments to clients (Kapta, B2B PT).

Commitment language: "vou enviar/verificar/ligar", "fico de", "envio amanhã", "ficou acordado", "Pedro ficou de", "I'll send/check/call/follow up", "we agreed".
Meeting notes 3rd person: "Pedro ficou de enviar…" still counts.

Per item return:
- customer_id: string
- interaction_type: "email"|"whatsapp"|"meeting"|"call"|"note"
- commitment_text: PT, ≤15 words
- suggested_title: PT, ≤10 words, infinitive verb (e.g. "Enviar proposta atualizada")
- suggested_priority: "low"|"medium"|"high"|"urgent"

Priority: urgent=deadline ≤2d or churn risk; high=this week or financial; medium=general; low=informal.

Output: JSON array. If no commitments found, return [] (empty array). NEVER return prose, NEVER wrap in object, NEVER add markdown fences. ONLY a JSON array starting with [ and ending with ].`

type CommitmentResult = {
  customer_id: string
  interaction_type: string
  commitment_text: string
  suggested_title: string
  suggested_priority: 'low' | 'medium' | 'high' | 'urgent'
}

/**
 * Lenient parser for Claude responses. Accepts:
 *   - clean JSON array: [{...}, {...}]
 *   - markdown-fenced array: ```json\n[...]\n```
 *   - object wrapping array: { "commitments": [...] } or { "results": [...] }
 *   - prose with no commitments: "I found no commitments" -> treats as []
 * Returns null only if the response is genuinely unparseable.
 */
function parseCommitments(raw: string): CommitmentResult[] | null {
  if (!raw) return []

  // Strip markdown code fences
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()

  // Direct array
  const arrayMatch = stripped.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0])
      if (Array.isArray(parsed)) return parsed as CommitmentResult[]
    } catch { /* fall through */ }
  }

  // Object with array property
  const objectMatch = stripped.match(/\{[\s\S]*\}/)
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]) as Record<string, unknown>
      for (const key of ['commitments', 'results', 'items', 'data']) {
        const v = parsed[key]
        if (Array.isArray(v)) return v as CommitmentResult[]
      }
    } catch { /* fall through */ }
  }

  // Prose indicating no commitments
  const lower = stripped.toLowerCase()
  if (
    lower.includes('no commitment') ||
    lower.includes('nenhum compromisso') ||
    lower.includes('sem compromisso') ||
    stripped.length === 0
  ) {
    return []
  }

  return null
}

type CommitmentSuggestion = CommitmentResult & {
  customer_name: string
  customer_company: string | null
}

export async function POST(req: Request) {
  const denied = requireAuth(req)
  if (denied) return denied
  const supabase = createServiceClient()

  // Fetch last 60 days across all relevant interaction types
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()

  const { data: interactions } = await supabase
    .from('interactions')
    .select('id, customer_id, type, direction, subject, content, metadata, occurred_at, customers(id, name, company)')
    .gte('occurred_at', since)
    .or('type.eq.meeting,type.eq.call,type.eq.note,and(type.eq.email,direction.eq.outbound),and(type.eq.whatsapp,direction.eq.outbound)')
    .order('occurred_at', { ascending: false })
    .limit(300)

  if (!interactions || interactions.length === 0) {
    return NextResponse.json({ ok: true, results: [], scanned: 0, skipped_existing: 0, message: 'Sem interações para analisar.' })
  }

  // Dedup: 1 most-recent per (customer_id + type) to spread token budget across channels
  const seen = new Set<string>()
  const deduped: typeof interactions = []
  for (const i of interactions) {
    const key = `${i.customer_id}:${i.type}`
    if (!seen.has(key) && i.content && i.content.trim().length > 10) {
      seen.add(key)
      deduped.push(i)
    }
  }

  const batch = deduped.slice(0, 50)
  if (batch.length === 0) {
    return NextResponse.json({ ok: true, results: [], scanned: 0, skipped_existing: 0, message: 'Sem conteúdo para analisar.' })
  }

  // Load existing open follow-ups for duplicate detection
  const { data: openFollowUps } = await supabase
    .from('follow_ups')
    .select('customer_id, title')
    .eq('status', 'open')

  const openTitles = new Map<string, string[]>()
  for (const fu of openFollowUps ?? []) {
    const arr = openTitles.get(fu.customer_id) ?? []
    arr.push(fu.title.toLowerCase())
    openTitles.set(fu.customer_id, arr)
  }

  // Build Claude input
  const itemsText = batch.map((i) => {
    const customer = Array.isArray(i.customers) ? i.customers[0] : i.customers
    const label = customer ? `${customer.name}${customer.company ? ` (${customer.company})` : ''}` : 'Desconhecido'
    const atts = ((i.metadata as Record<string, unknown>)?.attachments as Array<{ name: string; ai_summary?: string }> | undefined) ?? []
    const attSuffix = atts.length > 0 ? ` [Attachments: ${atts.map((a) => `${a.name}: ${a.ai_summary ?? a.name}`).join(' | ')}]` : ''
    const body = (i.content ?? '').slice(0, 800) + attSuffix
    return JSON.stringify({
      customer_id: i.customer_id,
      type: i.type,
      customer: label,
      subject: i.subject ?? null,
      date: i.occurred_at,
      content: body,
    })
  }).join('\n')

  const memory = await getAiMemory()

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  let message
  try {
    message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      temperature: 0.2,
      system: [{ type: 'text', text: `${SYSTEM_PROMPT}${memorySystemBlock(memory)}`, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Find Pedro's commitments. Return ONLY a JSON array (or [] if none):\n\n${itemsText}` }],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Claude API error:', msg)
    return NextResponse.json({ ok: false, error: `Claude error: ${msg}` }, { status: 500 })
  }

  const rawText = message.content[0].type === 'text' ? message.content[0].text : ''
  const claudeResults = parseCommitments(rawText)
  if (claudeResults === null) {
    console.error('Claude non-array response:', rawText.slice(0, 300))
    return NextResponse.json({ ok: false, error: 'Claude returned unexpected format' }, { status: 500 })
  }

  // Enrich + skip duplicates
  let skippedExisting = 0
  const results: CommitmentSuggestion[] = []

  for (const r of claudeResults) {
    const interaction = batch.find((i) => i.customer_id === r.customer_id)
    if (!interaction) continue

    // Fuzzy duplicate check
    const existingTitles = openTitles.get(r.customer_id) ?? []
    const titleLower = r.suggested_title.toLowerCase()
    const isDuplicate = existingTitles.some(
      (t) => t.includes(titleLower.slice(0, 15)) || titleLower.includes(t.slice(0, 15))
    )
    if (isDuplicate) { skippedExisting++; continue }

    const customer = Array.isArray(interaction.customers) ? interaction.customers[0] : interaction.customers
    results.push({
      ...r,
      customer_name: customer?.name ?? 'Desconhecido',
      customer_company: customer?.company ?? null,
    })
  }

  return NextResponse.json({ ok: true, results, scanned: batch.length, skipped_existing: skippedExisting })
}
