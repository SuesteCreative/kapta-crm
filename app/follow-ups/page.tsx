export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
import { FollowUpsClient } from '@/components/follow-ups-client'

export default async function FollowUpsPage() {
  const supabase = createServiceClient()
  // Manual follow-ups
  const { data: followUps } = await supabase
    .from('follow_ups')
    .select('*, customers(id, name, company)')
    .order('due_date', { ascending: true })

  // Smart "needs reply": fetch recent email interactions to compute in client.
  // Last 200 email interactions — client deduplicates per customer and filters inbound-last.
  // 200 covers ~weeks of activity; older follow-up needs are surfaced via the manual list.
  const { data: emailInteractions } = await supabase
    .from('interactions')
    .select('id, customer_id, direction, subject, occurred_at, metadata, customers(id, name, company, company_id, customer_identifiers(value, type, is_primary))')
    .eq('type', 'email')
    .order('occurred_at', { ascending: false })
    .limit(200)

  return (
    <FollowUpsClient
      followUps={followUps ?? []}
      emailInteractions={emailInteractions ?? []}
    />
  )
}
