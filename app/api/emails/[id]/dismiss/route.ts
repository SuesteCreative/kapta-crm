import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// Mark an email as spam/dismissed (metadata.is_spam = true). Server-side:
// `interactions` RLS denies the browser's anon role, so the old browser-direct
// update silently failed and dismissals never stuck. Reads the current row
// first to preserve the rest of metadata.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireAuth(request)
  if (denied) return denied

  const { id } = await params
  const supabase = createServiceClient()

  const { data: row, error: readErr } = await supabase
    .from('interactions')
    .select('metadata')
    .eq('id', id)
    .maybeSingle()
  if (readErr) return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 })

  const current = (row?.metadata as Record<string, unknown> | null) ?? {}
  const { error } = await supabase
    .from('interactions')
    .update({ metadata: { ...current, is_spam: true } })
    .eq('id', id)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
