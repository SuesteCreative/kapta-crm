export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
import { CompaniesClient } from '@/components/companies-client'

export default async function CompaniesPage() {
  const supabase = createServiceClient()

  const { data: companies } = await supabase
    .from('companies')
    .select('*, customers(id)')
    .order('name')

  return <CompaniesClient companies={companies ?? []} />
}
