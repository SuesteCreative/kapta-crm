export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
import { FhIntegrationsClient } from '@/components/fh-integrations-client'

export default async function FareHarborPage() {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('fh_integrations')
    .select('*, customers(id, name, company)')
    .order('created_at', { ascending: false })

  return <FhIntegrationsClient rows={data ?? []} />
}
