export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
import { TicketsClient } from '@/components/tickets-client'

export default async function TicketsPage() {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('tickets')
    .select('*, customers(id, name, company, plan, status, customer_identifiers(type, value, is_primary))')
    .order('created_at', { ascending: false })

  return <TicketsClient tickets={data ?? []} />
}
