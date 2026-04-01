export const dynamic = 'force-dynamic'

import { supabase } from '@/lib/supabase'
import { DashboardClient } from '@/components/dashboard-client'

async function getDashboardData() {
  const today = new Date().toISOString().split('T')[0]

  const [overdueRes, todayRes, customersRes, openTicketsRes, recentRes] = await Promise.all([
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
    supabase
      .from('interactions')
      .select('*, customers(name, company)')
      .order('occurred_at', { ascending: false })
      .limit(8),
  ])

  return {
    overdue: overdueRes.data ?? [],
    today: todayRes.data ?? [],
    customers: customersRes.data ?? [],
    openTickets: openTicketsRes.count ?? 0,
    recent: recentRes.data ?? [],
  }
}

export default async function DashboardPage() {
  const data = await getDashboardData()
  return <DashboardClient data={data} />
}
