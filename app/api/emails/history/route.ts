import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// Recent interactions for one customer, used by the reply dialog to decide
// whether to show the "Gerar resposta com IA" box (needs prior email history)
// and to feed that history to the AI. Server-side because `interactions` RLS
// grants only the authenticated/service_role roles — the browser's anon role
// reads zero rows, which silently hid the AI draft box.
export async function GET(request: Request) {
  const denied = requireAuth(request)
  if (denied) return denied

  const customerId = new URL(request.url).searchParams.get('customerId')
  if (!customerId) {
    return NextResponse.json({ ok: false, error: 'customerId required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('interactions')
    .select('*')
    .eq('customer_id', customerId)
    .order('occurred_at', { ascending: false })
    .limit(20)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, interactions: data ?? [] })
}
