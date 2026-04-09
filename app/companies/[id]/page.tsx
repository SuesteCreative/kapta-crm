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
  const { data: interactions } = customerIds.length
    ? await supabase
        .from('interactions')
        .select('*')
        .in('customer_id', customerIds)
        .order('occurred_at', { ascending: false })
    : { data: [] }

  return (
    <CompanyDetailClient
      company={company}
      customers={customers ?? []}
      interactions={interactions ?? []}
    />
  )
}
