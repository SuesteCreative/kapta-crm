export const dynamic = 'force-dynamic'

import { supabase } from '@/lib/supabase'
import { FollowUpsClient } from '@/components/follow-ups-client'

export default async function FollowUpsPage() {
  const { data } = await supabase
    .from('follow_ups')
    .select('*, customers(id, name, company)')
    .order('due_date', { ascending: true })

  return <FollowUpsClient followUps={data ?? []} />
}
