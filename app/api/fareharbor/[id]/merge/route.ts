import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/api-auth'
import { mergeCustomers } from '@/lib/merge-customers'

export const dynamic = 'force-dynamic'

/**
 * Merge a duplicate FareHarbor integration into the one to keep.
 *
 *   POST /api/fareharbor/<duplicateId>/merge   body { keeper_id }
 *
 * Same company submitted twice with slightly different shortname/email, so two
 * fh_integrations rows (and two customers) were created. This folds the
 * duplicate's customer — and therefore all its email history/identifiers — into
 * the keeper's customer, carries over any notes, unflags the duplicate's source
 * email, then deletes the duplicate row.
 *
 * → { ok: true, keeper_id } | { ok: false, error }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAuth(req)
  if (denied) return denied

  const { id: dupId } = await params

  let body: { keeper_id?: string } = {}
  try { body = await req.json() } catch { /* default */ }
  const keeperId = body.keeper_id

  if (!keeperId || keeperId === dupId) {
    return NextResponse.json({ ok: false, error: 'keeper_id inválido.' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: rows, error: readErr } = await supabase
    .from('fh_integrations')
    .select('id, customer_id, source_interaction_id, notes')
    .in('id', [dupId, keeperId])

  if (readErr) return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 })

  const dup    = (rows ?? []).find((r) => r.id === dupId)
  const keeper = (rows ?? []).find((r) => r.id === keeperId)
  if (!dup || !keeper) {
    return NextResponse.json({ ok: false, error: 'Integração não encontrada.' }, { status: 404 })
  }

  // Consolidate customers so the duplicate's email history follows the keeper.
  if (dup.customer_id && keeper.customer_id && dup.customer_id !== keeper.customer_id) {
    const merged = await mergeCustomers(supabase, keeper.customer_id, dup.customer_id)
    if (!merged.ok) return NextResponse.json(merged, { status: 500 })
  } else if (dup.customer_id && !keeper.customer_id) {
    // Keeper wasn't linked — adopt the duplicate's customer instead of dropping it.
    const { error: linkErr } = await supabase
      .from('fh_integrations')
      .update({ customer_id: dup.customer_id })
      .eq('id', keeperId)
    if (linkErr) return NextResponse.json({ ok: false, error: linkErr.message }, { status: 500 })
  }

  // Carry the duplicate's notes onto the keeper (don't lose written context).
  if (dup.notes && dup.notes.trim()) {
    const combined = [keeper.notes?.trim(), dup.notes.trim()].filter(Boolean).join('\n\n— (unido de duplicado) —\n')
    const { error: noteErr } = await supabase
      .from('fh_integrations')
      .update({ notes: combined })
      .eq('id', keeperId)
    if (noteErr) return NextResponse.json({ ok: false, error: noteErr.message }, { status: 500 })
  }

  // Unflag the duplicate's source email so it doesn't re-surface as pending.
  if (dup.source_interaction_id) {
    const { data: srcRow } = await supabase
      .from('interactions')
      .select('metadata')
      .eq('id', dup.source_interaction_id)
      .maybeSingle()
    const md = (srcRow?.metadata ?? null) as Record<string, unknown> | null
    if (md && md.fh_integration_id) {
      const next = { ...md }
      delete next.fh_integration_id
      await supabase.from('interactions').update({ metadata: next }).eq('id', dup.source_interaction_id)
    }
  }

  const { error: delErr } = await supabase.from('fh_integrations').delete().eq('id', dupId)
  if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, keeper_id: keeperId })
}
