export const dynamic = 'force-dynamic'

import { supabase } from '@/lib/supabase'
import { FollowUpsClient } from '@/components/follow-ups-client'

export default async function FollowUpsPage() {
  // Manual follow-ups
  const { data: followUps } = await supabase
    .from('follow_ups')
    .select('*, customers(id, name, company)')
    .order('due_date', { ascending: true })

  // Smart "needs reply": fetch recent email interactions to compute in client
  // Last 500 email interactions — client will deduplicate per customer and filter inbound-last
  const { data: emailInteractions } = await supabase
    .from('interactions')
    .select('customer_id, direction, subject, occurred_at, customers(id, name, company, company_id)')
    .eq('type', 'email')
    .order('occurred_at', { ascending: false })
    .limit(500)

  return (
    <FollowUpsClient
      followUps={followUps ?? []}
      emailInteractions={emailInteractions ?? []}
    />
  )
}
