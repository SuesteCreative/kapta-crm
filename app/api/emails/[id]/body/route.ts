import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// Lazy-load a single email's full body. MUST be server-side: `interactions`
// has RLS enabled with no policy, so the browser's anon role reads zero rows.
// The service-role client bypasses RLS; this route is gated by requireAuth, so
// only the authenticated CRM user (kapta_session cookie) can reach it.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireAuth(request)
  if (denied) return denied

  const { id } = await params
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('interactions')
    .select('content, metadata')
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })

  const meta = data.metadata as Record<string, unknown> | null
  return NextResponse.json({
    ok: true,
    content: (data.content as string | null) ?? null,
    html: (meta?.html as string | null | undefined) ?? null,
  })
}
