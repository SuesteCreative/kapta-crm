import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  const supabase = createServiceClient()

  let body: { preview?: boolean; confirm?: boolean } = {}
  try { body = await request.json() } catch { /* default */ }
  const { preview, confirm } = body

  if (!preview && !confirm) {
    return NextResponse.json({ ok: false, error: 'preview or confirm required' }, { status: 400 })
  }

  // 1. Load all email identifiers in one query → email → customer_id
  const { data: identifiers, error: idErr } = await supabase
    .from('customer_identifiers')
    .select('value, customer_id')
    .eq('type', 'email')

  if (idErr) return NextResponse.json({ ok: false, error: idErr.message }, { status: 500 })

  // Skip emails registered on 2+ customers (ambiguous)
  const emailCount = new Map<string, number>()
  for (const id of identifiers ?? []) {
    const e = id.value.toLowerCase().trim()
    emailCount.set(e, (emailCount.get(e) ?? 0) + 1)
  }
  const emailToCustomer = new Map<string, string>()
  for (const id of identifiers ?? []) {
    const e = id.value.toLowerCase().trim()
    if ((emailCount.get(e) ?? 0) === 1) emailToCustomer.set(e, id.customer_id)
  }

  if (emailToCustomer.size === 0) {
    return NextResponse.json({ ok: true, preview: !!preview, total: 0, groups: 0 })
  }

  // 2. Load ALL interactions that have a matched_email set — one query, no N+1
  const { data: interactions, error: intErr } = await supabase
    .from('interactions')
    .select('id, customer_id, metadata')
    .not('metadata->>matched_email', 'is', null)
    .range(0, 9999)

  if (intErr) return NextResponse.json({ ok: false, error: intErr.message }, { status: 500 })

  // 3. Filter in JS: interactions where matched_email maps to a different customer
  type MoveItem = { id: string; wrong_customer_id: string; correct_customer_id: string }
  const toMove: MoveItem[] = []

  for (const row of interactions ?? []) {
    const meta = row.metadata as Record<string, unknown> | null
    const matchedEmail = (meta?.matched_email as string | undefined)?.toLowerCase().trim()
    if (!matchedEmail) continue

    const correctId = emailToCustomer.get(matchedEmail)
    if (!correctId) continue           // email not registered on any customer
    if (correctId === row.customer_id) continue  // already correct

    toMove.push({ id: row.id, wrong_customer_id: row.customer_id, correct_customer_id: correctId })
  }

  // Count distinct wrong customers for grouping info
  const wrongCustomers = new Set(toMove.map((m) => m.wrong_customer_id))

  if (preview) {
    return NextResponse.json({ ok: true, preview: true, total: toMove.length, groups: wrongCustomers.size })
  }

  if (toMove.length === 0) {
    return NextResponse.json({ ok: true, moved: 0, orphaned_customer_ids: [] })
  }

  // 4. Batch update by correct_customer_id (one update per destination, not per row)
  const byDestination = new Map<string, string[]>()
  for (const item of toMove) {
    const ids = byDestination.get(item.correct_customer_id) ?? []
    ids.push(item.id)
    byDestination.set(item.correct_customer_id, ids)
  }

  let moved = 0
  for (const [correctId, ids] of byDestination) {
    const { error } = await supabase
      .from('interactions')
      .update({ customer_id: correctId })
      .in('id', ids)
    if (!error) moved += ids.length
  }

  // 5. Detect orphaned customers (0 interactions + 0 tickets + 0 follow-ups)
  const orphanedCustomerIds: string[] = []
  for (const wrongId of wrongCustomers) {
    const [{ count: intCount }, { count: ticketCount }, { count: fuCount }] = await Promise.all([
      supabase.from('interactions').select('id', { count: 'exact', head: true }).eq('customer_id', wrongId),
      supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('customer_id', wrongId),
      supabase.from('follow_ups').select('id', { count: 'exact', head: true }).eq('customer_id', wrongId),
    ])
    if ((intCount ?? 0) === 0 && (ticketCount ?? 0) === 0 && (fuCount ?? 0) === 0) {
      orphanedCustomerIds.push(wrongId)
    }
  }

  return NextResponse.json({ ok: true, moved, orphaned_customer_ids: orphanedCustomerIds })
}
