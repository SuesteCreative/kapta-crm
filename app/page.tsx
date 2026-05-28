export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { createServiceClient } from '@/lib/supabase'
import { DashboardClient } from '@/components/dashboard-client'
import { DashboardEmailsCard, DashboardEmailsCardSkeleton } from '@/components/dashboard-emails-card'

// Fast queries — paint the dashboard skeleton + KPI counters + follow-ups
// + status pills immediately. The heavy "Emails: o que responder" card is
// streamed in via <Suspense /> below.
async function getDashboardLight() {
  const supabase = createServiceClient()
  const today = new Date().toISOString().split('T')[0]

  const [overdueRes, todayRes, customersRes, openTicketsRes, unreadRes] = await Promise.all([
    supabase
      .from('follow_ups')
      .select('*, customers(name, company)')
      .eq('status', 'open')
      .lt('due_date', today)
      .order('due_date', { ascending: true }),
    supabase
      .from('follow_ups')
      .select('*, customers(name, company)')
      .eq('status', 'open')
      .eq('due_date', today)
      .order('priority', { ascending: false }),
    supabase
      .from('customers')
      .select('id, status')
      .neq('status', 'churned'),
    supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open'),
    // Cheap KPI count — backed by partial index on (occurred_at) where
    // type='email' AND direction='inbound'. is_read defaults to true; sync
    // sets inbound rows to false → count = "things I haven't looked at".
    // If the is_read column is missing (migration not applied) the query
    // errors out and we just show 0.
    supabase
      .from('interactions')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'email')
      .eq('direction', 'inbound')
      .eq('is_read', false)
      .then(
        (r) => r,
        () => ({ count: 0, error: null, data: null, status: 0, statusText: '' }),
      ),
  ])

  return {
    overdue: overdueRes.data ?? [],
    today: todayRes.data ?? [],
    customers: customersRes.data ?? [],
    openTickets: openTicketsRes.count ?? 0,
    unreadInboundCount: unreadRes.error ? 0 : (unreadRes.count ?? 0),
  }
}

export default async function DashboardPage() {
  const data = await getDashboardLight()
  return (
    <DashboardClient
      data={data}
      emailsSlot={
        <Suspense fallback={<DashboardEmailsCardSkeleton />}>
          <DashboardEmailsCard />
        </Suspense>
      }
    />
  )
}
