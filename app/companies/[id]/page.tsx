export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase'
import { CompanyDetailClient } from '@/components/company-detail-client'

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServiceClient()

  const [{ data: company }, { data: customers }] = await Promise.all([
    supabase.from('companies').select('*').eq('id', id).single(),
    supabase
      .from('customers')
      .select('*, customer_identifiers(*)')
      .eq('company_id', id)
      .order('name'),
  ])

  if (!company) notFound()

  const customerIds = (customers ?? []).map((c) => c.id)

  const [{ data: interactions }, { data: followUps }, { data: tickets }] = await Promise.all([
    customerIds.length
      ? supabase.from('interactions').select('*').in('customer_id', customerIds).order('occurred_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    customerIds.length
      ? supabase.from('follow_ups').select('id').in('customer_id', customerIds).eq('status', 'open')
      : Promise.resolve({ data: [] }),
    customerIds.length
      ? supabase.from('tickets').select('id').in('customer_id', customerIds).in('status', ['open', 'in-progress'])
      : Promise.resolve({ data: [] }),
  ])

  return (
    <CompanyDetailClient
      company={company}
      customers={customers ?? []}
      interactions={interactions ?? []}
      openFollowUps={followUps?.length ?? 0}
      openTickets={tickets?.length ?? 0}
    />
  )
}
