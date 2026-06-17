import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// Toggle an email's read state. Server-side: `interactions` RLS denies the
// browser's anon role, so the old browser-direct update silently no-op'd and
// read/unread never persisted.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireAuth(request)
  if (denied) return denied

  const { id } = await params
  const body = await request.json().catch(() => ({} as { is_read?: boolean }))
  const isRead = !!body.is_read

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('interactions')
    .update({ is_read: isRead })
    .eq('id', id)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
