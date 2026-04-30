export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
import { EmailsClient } from '@/components/emails-client'
import type { ComponentProps } from 'react'

export default async function EmailsPage() {
  const supabase = createServiceClient()
  // Pull only what the list view + preview header need. The full HTML body
  // is fetched lazily in EmailsClient when the user selects a row.
  const fullSelect = `
      id, customer_id, direction, subject, occurred_at, metadata, is_read,
      customers ( id, name, company, customer_identifiers ( type, value ) )
    `
  const fallbackSelect = `
      id, customer_id, direction, subject, occurred_at, metadata,
      customers ( id, name, company, customer_identifiers ( type, value ) )
    `

  let { data: rows, error } = await supabase
    .from('interactions')
    .select(fullSelect)
    .eq('type', 'email')
    .order('occurred_at', { ascending: false })
    .limit(500)

  // Fallback: is_read column missing (migration not applied) — fetch without it
  // and treat all rows as read so the list still renders.
  if (error || !rows) {
    const fb = await supabase
      .from('interactions')
      .select(fallbackSelect)
      .eq('type', 'email')
      .order('occurred_at', { ascending: false })
      .limit(500)
    rows = (fb.data ?? []).map((r) => ({ ...r, is_read: true })) as typeof rows
  }

  type Emails = ComponentProps<typeof EmailsClient>['emails']
  return <EmailsClient emails={(rows ?? []) as unknown as Emails} />
}
