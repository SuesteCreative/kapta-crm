export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
import { EmailsClient } from '@/components/emails-client'
import type { ComponentProps } from 'react'

export default async function EmailsPage() {
  const supabase = createServiceClient()
  // Pull only what the list view + preview header need. The full HTML body
  // is fetched lazily in EmailsClient when the user selects a row.
  const { data: rows } = await supabase
    .from('interactions')
    .select(`
      id, customer_id, direction, subject, occurred_at, metadata, is_read,
      customers ( id, name, company, customer_identifiers ( type, value ) )
    `)
    .eq('type', 'email')
    .order('occurred_at', { ascending: false })
    .limit(500)

  type Emails = ComponentProps<typeof EmailsClient>['emails']
  return <EmailsClient emails={(rows ?? []) as unknown as Emails} />
}
