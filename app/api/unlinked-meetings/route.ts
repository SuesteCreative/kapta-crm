import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('unlinked_meetings')
    .select('id, title, summary, bubbles_url, attendees, recorded_at')
    .is('assigned_at', null)
    .order('recorded_at', { ascending: false })
    .limit(50)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, meetings: data ?? [] })
}
