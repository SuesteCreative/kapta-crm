export const dynamic = 'force-dynamic'

import { supabase } from '@/lib/supabase'
import { TicketsClient } from '@/components/tickets-client'

export default async function TicketsPage() {
  const { data } = await supabase
    .from('tickets')
    .select('*, customers(id, name, company)')
    .order('created_at', { ascending: false })

  return <TicketsClient tickets={data ?? []} />
}
