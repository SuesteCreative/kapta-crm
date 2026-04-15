import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface RequestBody {
  email: string
  preview?: boolean
  confirm?: boolean
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createServiceClient()

  let body: RequestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const { email, preview, confirm } = body
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ ok: false, error: 'email required' }, { status: 400 })
  }

  const normalizedEmail = email.toLowerCase().trim()

  // 1. Conflict check — is this email already registered to a DIFFERENT customer?
  const { data: conflictRows } = await supabase
    .from('customer_identifiers')
    .select('customer_id, customers(name)')
    .eq('type', 'email')
    .eq('value', normalizedEmail)
    .neq('customer_id', id)

  if (conflictRows && conflictRows.length > 0) {
    const row = conflictRows[0]
    const owner = Array.isArray(row.customers) ? row.customers[0] : row.customers
    return NextResponse.json({
      ok: false,
      conflict: true,
      owner_id: row.customer_id,
      owner_name: (owner as { name: string } | null)?.name ?? 'Desconhecido',
    })
  }

  // 2. Find interactions currently under another customer matched by this email
  const { data: toRelink } = await supabase
    .from('interactions')
    .select('id, customer_id, customers(name)')
    .eq('metadata->>matched_email', normalizedEmail)
    .neq('customer_id', id)

  const count = toRelink?.length ?? 0

  // Preview mode — return count without making changes
  if (preview) {
    const sourceNames = [...new Set((toRelink ?? []).map((i) => {
      const c = Array.isArray(i.customers) ? i.customers[0] : i.customers
      return (c as { name: string } | null)?.name ?? 'Desconhecido'
    }))]
    return NextResponse.json({ ok: true, preview: true, count, source_names: sourceNames })
  }

  // Require explicit confirm for destructive operation
  if (!confirm) {
    return NextResponse.json({ ok: false, error: 'preview or confirm required' }, { status: 400 })
  }

  // 3. Perform re-link (only if there's something to move)
  if (count > 0) {
    const { error: updateError } = await supabase
      .from('interactions')
      .update({ customer_id: id })
      .eq('metadata->>matched_email', normalizedEmail)
      .neq('customer_id', id)

    if (updateError) {
      return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 })
    }
  }

  // 4. Detect orphaned customers — those with 0 interactions AND 0 tickets AND 0 follow-ups
  // All three must be empty before we consider a customer safe to delete
  const prevOwnerIds = [...new Set((toRelink ?? []).map((i) => i.customer_id))]
  const orphanedCustomerIds: string[] = []

  for (const ownerId of prevOwnerIds) {
    const [{ count: intCount }, { count: ticketCount }, { count: followUpCount }] = await Promise.all([
      supabase.from('interactions').select('id', { count: 'exact', head: true }).eq('customer_id', ownerId),
      supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('customer_id', ownerId),
      supabase.from('follow_ups').select('id', { count: 'exact', head: true }).eq('customer_id', ownerId),
    ])

    if ((intCount ?? 0) === 0 && (ticketCount ?? 0) === 0 && (followUpCount ?? 0) === 0) {
      orphanedCustomerIds.push(ownerId)
    }
  }

  return NextResponse.json({ ok: true, relinked: count, orphaned_customer_ids: orphanedCustomerIds })
}
