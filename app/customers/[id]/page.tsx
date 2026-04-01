export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { CustomerDetailClient } from '@/components/customer-detail-client'

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [customerRes, interactionsRes, followUpsRes, ticketsRes] = await Promise.all([
    supabase.from('customers').select('*, customer_identifiers(*)').eq('id', id).single(),
    supabase.from('interactions').select('*').eq('customer_id', id).order('occurred_at', { ascending: false }),
    supabase.from('follow_ups').select('*').eq('customer_id', id).order('due_date', { ascending: true }),
    supabase.from('tickets').select('*').eq('customer_id', id).order('created_at', { ascending: false }),
  ])

  if (!customerRes.data) notFound()

  return (
    <CustomerDetailClient
      customer={customerRes.data}
      interactions={interactionsRes.data ?? []}
      followUps={followUpsRes.data ?? []}
      tickets={ticketsRes.data ?? []}
    />
  )
}
