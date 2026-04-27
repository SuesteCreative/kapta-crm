export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase'
import { CustomerDetailClient } from '@/components/customer-detail-client'

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServiceClient()

  const [customerRes, followUpsRes, ticketsRes] = await Promise.all([
    supabase.from('customers').select('*, customer_identifiers(*)').eq('id', id).single(),
    supabase.from('follow_ups').select('*').eq('customer_id', id).order('due_date', { ascending: true }),
    supabase.from('tickets').select('*').eq('customer_id', id).order('created_at', { ascending: false }),
  ])

  if (!customerRes.data) notFound()

  // Primary: interactions directly linked to this customer
  const { data: primaryInteractions } = await supabase
    .from('interactions')
    .select('*')
    .eq('customer_id', id)
    .order('occurred_at', { ascending: false })

  // Secondary: interactions from OTHER customers matched by any of this customer's email identifiers
  // Catches emails synced before the identifier was registered (or auto-created duplicates not yet re-linked)
  const emailValues = (customerRes.data.customer_identifiers ?? [])
    .filter((i: { type: string }) => i.type === 'email')
    .map((i: { value: string }) => i.value)

  let secondaryInteractions: typeof primaryInteractions = []
  if (emailValues.length > 0) {
    // Single query covering all of this customer's email aliases.
    // PostgREST OR-of-eq form: metadata->>matched_email.eq.foo,metadata->>matched_email.eq.bar
    const orClauses = emailValues
      .map((e: string) => `metadata->>matched_email.eq.${e.replace(/,/g, '')}`)
      .join(',')
    const { data } = await supabase
      .from('interactions')
      .select('*')
      .or(orClauses)
      .neq('customer_id', id)
    secondaryInteractions = data ?? []
  }

  // Merge + deduplicate + sort newest-first
  const seenIds = new Set<string>()
  const allInteractions = [...(primaryInteractions ?? []), ...(secondaryInteractions ?? [])]
    .filter((i) => { if (seenIds.has(i.id)) return false; seenIds.add(i.id); return true })
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())

  return (
    <CustomerDetailClient
      customer={customerRes.data}
      interactions={allInteractions}
      followUps={followUpsRes.data ?? []}
      tickets={ticketsRes.data ?? []}
    />
  )
}
