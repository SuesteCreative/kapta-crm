import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Zapier sends Bubbles meeting data — we match attendee emails to customers
// Expected body (fields Zapier maps from Bubbles):
// {
//   secret: string,
//   title: string,
//   summary: string,
//   transcript: string,
//   url: string,
//   recorded_at: string,   // ISO date
//   attendees: string,     // comma-separated emails or "Name <email>, ..."
// }

function parseEmails(raw: string): string[] {
  if (!raw) return []
  // Handle "Name <email@x.com>, ..." or plain "email@x.com, email2@x.com"
  const matches = raw.match(/[\w.+-]+@[\w-]+\.[\w.]+/g)
  return matches ?? []
}

export async function POST(req: Request) {
  let body: Record<string, string>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  // Auth
  if (body.secret !== process.env.BUBBLES_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const {
    title = 'Reunião',
    summary = '',
    transcript = '',
    url = '',
    recorded_at,
    attendees = '',
  } = body

  const supabase = createServiceClient()

  // Match attendee emails to customers (exclude pedro@kapta.pt)
  const emails = parseEmails(attendees).filter(
    (e) => !e.toLowerCase().includes('kapta.pt')
  )

  let customerId: string | null = null

  if (emails.length > 0) {
    const { data } = await supabase
      .from('customer_identifiers')
      .select('customer_id')
      .in('value', emails)
      .eq('type', 'email')
      .limit(1)
      .maybeSingle()
    customerId = data?.customer_id ?? null
  }

  // Build content: summary first, then transcript snippet
  const contentParts: string[] = []
  if (summary) contentParts.push(`Resumo:\n${summary}`)
  if (transcript) contentParts.push(`Transcrição:\n${transcript.slice(0, 3000)}`)
  const content = contentParts.join('\n\n') || '(sem conteúdo)'

  const occurredAt = recorded_at
    ? new Date(recorded_at).toISOString()
    : new Date().toISOString()

  if (customerId) {
    // Linked to a known customer
    await supabase.from('interactions').insert({
      customer_id: customerId,
      type: 'meeting',
      direction: null,
      subject: title,
      content,
      bubbles_url: url || null,
      bubbles_title: title || null,
      metadata: { source: 'bubbles' },
      occurred_at: occurredAt,
    })
    return NextResponse.json({ ok: true, matched: true, customer_id: customerId })
  }

  // No match — park in unlinked_meetings for Pedro to assign from dashboard
  const { data: unlinked, error } = await supabase
    .from('unlinked_meetings')
    .insert({
      title,
      summary,
      transcript,
      bubbles_url: url || null,
      attendees: emails,
      recorded_at: occurredAt,
    })
    .select('id')
    .single()

  if (error) {
    console.error('Failed to park unlinked meeting:', error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    matched: false,
    unlinked_meeting_id: unlinked.id,
    emails,
  })
}
