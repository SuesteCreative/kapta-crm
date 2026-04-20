export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
import { EmailsClient } from '@/components/emails-client'

export default async function EmailsPage() {
  const supabase = createServiceClient()
  const { data: rows } = await supabase
    .from('interactions')
    .select('*, customers(id, name, company, customer_identifiers(*))')
    .eq('type', 'email')
    .order('occurred_at', { ascending: false })
    .limit(500)

  return <EmailsClient emails={rows ?? []} />
}
