import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireAuth(request)
  if (denied) return denied
  const { id } = await params
  const supabase = createServiceClient()

  let body: { customer_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const customerId = body.customer_id
  if (!customerId) {
    return NextResponse.json({ ok: false, error: 'customer_id required' }, { status: 400 })
  }

  const { data: meeting, error: fetchError } = await supabase
    .from('unlinked_meetings')
    .select('id, title, summary, transcript, bubbles_url, recorded_at, assigned_at')
    .eq('id', id)
    .maybeSingle()

  if (fetchError || !meeting) {
    return NextResponse.json({ ok: false, error: 'Meeting not found' }, { status: 404 })
  }

  if (meeting.assigned_at) {
    return NextResponse.json({ ok: false, error: 'Already assigned' }, { status: 409 })
  }

  const contentParts: string[] = []
  if (meeting.summary) contentParts.push(`Resumo:\n${meeting.summary}`)
  if (meeting.transcript) contentParts.push(`Transcrição:\n${(meeting.transcript as string).slice(0, 3000)}`)
  const content = contentParts.join('\n\n') || '(sem conteúdo)'

  const { error: insertError } = await supabase.from('interactions').insert({
    customer_id: customerId,
    type: 'meeting',
    direction: null,
    subject: meeting.title,
    content,
    bubbles_url: meeting.bubbles_url,
    bubbles_title: meeting.title,
    metadata: { source: 'bubbles', from_unlinked: meeting.id },
    occurred_at: meeting.recorded_at,
  })

  if (insertError) {
    return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 })
  }

  const { error: updateError } = await supabase
    .from('unlinked_meetings')
    .update({ assigned_at: new Date().toISOString() })
    .eq('id', id)

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, customer_id: customerId })
}
