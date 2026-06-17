import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// Email templates / prompt presets. Server-side: `templates` RLS grants only
// the authenticated/service_role roles, so the browser's anon read returned an
// empty list (blank template dropdown). Defaults to type='email'.
export async function GET(request: Request) {
  const denied = requireAuth(request)
  if (denied) return denied

  const type = new URL(request.url).searchParams.get('type') ?? 'email'
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .eq('type', type)
    .order('name')

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, templates: data ?? [] })
}
