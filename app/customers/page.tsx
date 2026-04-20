export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
import { CustomersClient } from '@/components/customers-client'

export default async function CustomersPage() {
  const supabase = createServiceClient()
  const { data: customers } = await supabase
    .from('customers')
    .select('*, customer_identifiers(*)')
    .order('name')

  return <CustomersClient customers={customers ?? []} />
}
