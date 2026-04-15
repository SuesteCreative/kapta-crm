import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST { preview?: true } — returns count of interactions that would be moved
 * POST { confirm?: true } — performs re-link for ALL mismatched interactions
 *
 * Logic: for every email registered in customer_identifiers, find interactions
 * where metadata->>matched_email equals that email but customer_id differs.
 * Those interactions belong to the wrong customer and get moved.
 *
 * Safe: only moves interactions where the correct owner is unambiguous
 * (the email is explicitly registered as an identifier on exactly one customer).
 */
export async function POST(request: Request) {
  const supabase = createServiceClient()

  let body: { preview?: boolean; confirm?: boolean } = {}
  try { body = await request.json() } catch { /* default */ }
  const { preview, confirm } = body

  if (!preview && !confirm) {
    return NextResponse.json({ ok: false, error: 'preview or confirm required' }, { status: 400 })
  }

  // Load all email identifiers: email → customer_id
  const { data: identifiers, error: idErr } = await supabase
    .from('customer_identifiers')
    .select('value, customer_id')
    .eq('type', 'email')

  if (idErr) return NextResponse.json({ ok: false, error: idErr.message }, { status: 500 })

  // Detect ambiguous emails (same email registered on 2+ customers) — skip those
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
    return NextResponse.json({ ok: true, preview: !!preview, total: 0, orphaned_customer_ids: [] })
  }

  // For each registered email, find interactions under a different customer
  type MoveGroup = { email: string; correct_customer_id: string; interaction_ids: string[] }
  const moves: MoveGroup[] = []

  for (const [email, correctCustomerId] of emailToCustomer) {
    const { data: rows } = await supabase
      .from('interactions')
      .select('id, customer_id')
      .eq('metadata->>matched_email', email)
      .neq('customer_id', correctCustomerId)

    if (rows && rows.length > 0) {
      moves.push({ email, correct_customer_id: correctCustomerId, interaction_ids: rows.map((r) => r.id) })
    }
  }

  const total = moves.reduce((sum, m) => sum + m.interaction_ids.length, 0)

  if (preview) {
    return NextResponse.json({ ok: true, preview: true, total, groups: moves.length })
  }

  // Perform moves
  let moved = 0
  const affectedWrongCustomers = new Set<string>()

  for (const move of moves) {
    // Fetch wrong customer_ids before updating (need them for orphan check)
    const { data: before } = await supabase
      .from('interactions')
      .select('customer_id')
      .in('id', move.interaction_ids)
    for (const r of before ?? []) affectedWrongCustomers.add(r.customer_id)

    const { error } = await supabase
      .from('interactions')
      .update({ customer_id: move.correct_customer_id })
      .in('id', move.interaction_ids)

    if (!error) moved += move.interaction_ids.length
  }

  // Detect orphaned customers: 0 interactions + 0 tickets + 0 follow-ups
  const orphanedCustomerIds: string[] = []
  for (const wrongId of affectedWrongCustomers) {
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
