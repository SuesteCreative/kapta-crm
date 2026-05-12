export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase'
import { FhIntegrationDetailClient } from '@/components/fh-integration-detail-client'
import type { Interaction } from '@/lib/database.types'

export default async function FareHarborDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServiceClient()

  const { data: fh } = await supabase
    .from('fh_integrations')
    .select('*, customers(id, name, company, customer_identifiers(type, value, is_primary))')
    .eq('id', id)
    .maybeSingle()

  if (!fh) notFound()

  let sourceEmail: Interaction | null = null
  if (fh.source_interaction_id) {
    const { data } = await supabase
      .from('interactions')
      .select('*')
      .eq('id', fh.source_interaction_id)
      .maybeSingle()
    sourceEmail = (data as Interaction | null) ?? null
  }

  let interactions: Interaction[] = []
  if (fh.customer_id) {
    const { data } = await supabase
      .from('interactions')
      .select('*')
      .eq('customer_id', fh.customer_id)
      .order('occurred_at', { ascending: false })
    interactions = (data as Interaction[] | null) ?? []
  }

  return <FhIntegrationDetailClient fh={fh} sourceEmail={sourceEmail} interactions={interactions} />
}
