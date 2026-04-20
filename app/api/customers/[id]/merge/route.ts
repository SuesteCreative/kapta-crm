import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: targetId } = await params
  const supabase = createServiceClient()

  let body: { source_id?: string } = {}
  try { body = await request.json() } catch { /* default */ }
  const { source_id } = body

  if (!source_id || source_id === targetId) {
    return NextResponse.json({ ok: false, error: 'source_id inválido' }, { status: 400 })
  }

  // Move child records
  const [r1, r2, r3] = await Promise.all([
    supabase.from('interactions').update({ customer_id: targetId }).eq('customer_id', source_id),
    supabase.from('follow_ups').update({ customer_id: targetId }).eq('customer_id', source_id),
    supabase.from('tickets').update({ customer_id: targetId }).eq('customer_id', source_id),
  ])
  const moveError = r1.error ?? r2.error ?? r3.error
  if (moveError) return NextResponse.json({ ok: false, error: moveError.message }, { status: 500 })

  // Move identifiers — skip duplicates
  const [{ data: targetIds }, { data: sourceIds }] = await Promise.all([
    supabase.from('customer_identifiers').select('type, value').eq('customer_id', targetId),
    supabase.from('customer_identifiers').select('id, type, value').eq('customer_id', source_id),
  ])

  const targetSet = new Set((targetIds ?? []).map((i) => `${i.type}:${i.value.toLowerCase()}`))
  const toMove   = (sourceIds ?? []).filter((i) => !targetSet.has(`${i.type}:${i.value.toLowerCase()}`))
  const toDelete = (sourceIds ?? []).filter((i) =>  targetSet.has(`${i.type}:${i.value.toLowerCase()}`))

  await Promise.all([
    toMove.length   > 0 && supabase.from('customer_identifiers').update({ customer_id: targetId }).in('id', toMove.map((i) => i.id)),
    toDelete.length > 0 && supabase.from('customer_identifiers').delete().in('id', toDelete.map((i) => i.id)),
  ])

  // Delete source customer
  const { error: delErr } = await supabase.from('customers').delete().eq('id', source_id)
  if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
