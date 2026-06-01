import type { SupabaseClient } from '@supabase/supabase-js'

type IdRow = { id: string; type: string; value: string }

/**
 * Merge customer `sourceId` into `targetId`: move every child record and email
 * identifier onto the target, then delete the source customer. Shared by the
 * customer merge route and the FareHarbor duplicate-integration merge so both
 * paths behave identically.
 *
 * fh_integrations and email_drafts use ON DELETE SET NULL, so their links are
 * reassigned here rather than relying on the cascade.
 */
export async function mergeCustomers(
  supabase: SupabaseClient,
  targetId: string,
  sourceId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!sourceId || !targetId || sourceId === targetId) {
    return { ok: false, error: 'IDs inválidos para merge.' }
  }

  const [r1, r2, r3, r4, r5] = await Promise.all([
    supabase.from('interactions').update({ customer_id: targetId }).eq('customer_id', sourceId),
    supabase.from('follow_ups').update({ customer_id: targetId }).eq('customer_id', sourceId),
    supabase.from('tickets').update({ customer_id: targetId }).eq('customer_id', sourceId),
    supabase.from('fh_integrations').update({ customer_id: targetId }).eq('customer_id', sourceId),
    supabase.from('email_drafts').update({ primary_customer_id: targetId }).eq('primary_customer_id', sourceId),
  ])
  const moveError = r1.error ?? r2.error ?? r3.error ?? r4.error ?? r5.error
  if (moveError) return { ok: false, error: moveError.message }

  // Move identifiers, skipping ones the target already has (dedup by type+value).
  const [{ data: targetIds }, { data: sourceIds }] = await Promise.all([
    supabase.from('customer_identifiers').select('type, value').eq('customer_id', targetId),
    supabase.from('customer_identifiers').select('id, type, value').eq('customer_id', sourceId),
  ])

  const targetSet = new Set(((targetIds ?? []) as Pick<IdRow, 'type' | 'value'>[]).map((i) => `${i.type}:${i.value.toLowerCase()}`))
  const src = (sourceIds ?? []) as IdRow[]
  const toMove   = src.filter((i) => !targetSet.has(`${i.type}:${i.value.toLowerCase()}`))
  const toDelete = src.filter((i) =>  targetSet.has(`${i.type}:${i.value.toLowerCase()}`))

  await Promise.all([
    toMove.length   > 0 && supabase.from('customer_identifiers').update({ customer_id: targetId }).in('id', toMove.map((i) => i.id)),
    toDelete.length > 0 && supabase.from('customer_identifiers').delete().in('id', toDelete.map((i) => i.id)),
  ])

  const { error: delErr } = await supabase.from('customers').delete().eq('id', sourceId)
  if (delErr) return { ok: false, error: delErr.message }

  return { ok: true }
}
