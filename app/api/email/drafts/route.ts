import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

interface UpsertBody {
  id?: string
  primary_customer_id?: string | null
  to_recipients?: unknown[]
  cc_recipients?: unknown[]
  bcc_recipients?: unknown[]
  subject?: string
  body?: string
  prompt?: string
  language?: string
  attachments?: unknown[]
  inline_images?: unknown[]
}

export async function GET(req: Request) {
  const denied = requireAuth(req)
  if (denied) return denied
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('email_drafts')
    .select('id, primary_customer_id, to_recipients, subject, body, prompt, updated_at')
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, drafts: data ?? [] })
}

export async function POST(req: Request) {
  const denied = requireAuth(req)
  if (denied) return denied
  let body: UpsertBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const row = {
    primary_customer_id: body.primary_customer_id ?? null,
    to_recipients:  body.to_recipients  ?? [],
    cc_recipients:  body.cc_recipients  ?? [],
    bcc_recipients: body.bcc_recipients ?? [],
    subject:        body.subject ?? null,
    body:           body.body ?? null,
    prompt:         body.prompt ?? null,
    language:       body.language ?? 'pt-PT',
    attachments:    body.attachments ?? [],
    inline_images:  body.inline_images ?? [],
    updated_at:     new Date().toISOString(),
  }

  if (body.id) {
    const { data, error } = await supabase
      .from('email_drafts')
      .update(row)
      .eq('id', body.id)
      .select('id')
      .maybeSingle()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, id: data?.id ?? body.id })
  }

  const { data, error } = await supabase
    .from('email_drafts')
    .insert(row)
    .select('id')
    .single()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id })
}
