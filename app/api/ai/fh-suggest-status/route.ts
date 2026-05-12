import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SYSTEM_PROMPT = `You triage FareHarbor integration onboarding. Read partner record + email history. Pick state.

States:
- new              : no contact yet
- onboarding       : welcome email sent, waiting API key
- api_received     : API key received, integration not done
- integration_done : integration built, not yet live
- live             : in production
- troubleshoot     : active issue
- follow_up        : awaiting reply
- churned          : abandoned / declined

Output JSON only: {"status":"<one of above>","reason":"one short caveman sentence (max 12 words, Portuguese)"}
No fluff. No hedging. No markdown.`

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const VALID_STATUSES = new Set([
  'new', 'onboarding', 'api_received', 'integration_done',
  'live', 'troubleshoot', 'follow_up', 'churned',
])

export async function POST(req: Request) {
  const { fh_integration_id } = await req.json() as { fh_integration_id: string }
  if (!fh_integration_id) {
    return NextResponse.json({ ok: false, error: 'fh_integration_id required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: fh, error: fhErr } = await supabase
    .from('fh_integrations')
    .select('shortname, name, email, country, invoicing_system, status, fh_api_key, onboarding_email_sent_at, integration_completed_at, customer_id, last_contact_at, notes')
    .eq('id', fh_integration_id)
    .maybeSingle()

  if (fhErr || !fh) {
    return NextResponse.json({ ok: false, error: 'Integration not found' }, { status: 404 })
  }

  let interactions: Array<{ direction: string | null; subject: string | null; content: string | null; occurred_at: string }> = []
  if (fh.customer_id) {
    const { data } = await supabase
      .from('interactions')
      .select('direction, subject, content, occurred_at')
      .eq('customer_id', fh.customer_id)
      .order('occurred_at', { ascending: false })
      .limit(20)
    interactions = data ?? []
  }

  const partnerBlock = `Partner:
- name: ${fh.name}
- shortname: ${fh.shortname}
- email: ${fh.email}
- country: ${fh.country ?? '?'}
- invoicing: ${fh.invoicing_system ?? '?'}
- current_status: ${fh.status}
- api_key_present: ${fh.fh_api_key ? 'yes' : 'no'}
- onboarding_email_sent_at: ${fh.onboarding_email_sent_at ?? 'never'}
- integration_completed_at: ${fh.integration_completed_at ?? 'never'}
- last_contact_at: ${fh.last_contact_at ?? 'never'}
- notes: ${(fh.notes ?? '').slice(0, 400) || '—'}`

  const emailBlock = interactions.length === 0
    ? 'No emails in history.'
    : interactions.slice(0, 12).reverse().map((i, idx) => {
        const body = stripHtml(i.content ?? '').slice(0, 400)
        return `[${idx + 1}] ${i.occurred_at.slice(0, 10)} ${i.direction ?? '?'} | ${i.subject ?? '(no subject)'}\n${body}`
      }).join('\n\n')

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  let message
  try {
    message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `${partnerBlock}\n\n--- recent emails ---\n${emailBlock}` }],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Claude API error:', msg)
    return NextResponse.json({ ok: false, error: `Claude error: ${msg}` }, { status: 500 })
  }

  const rawText = message.content[0].type === 'text' ? message.content[0].text : ''
  const match = rawText.match(/\{[\s\S]*\}/)
  if (!match) {
    return NextResponse.json({ ok: false, error: 'Claude returned non-JSON', raw: rawText.slice(0, 200) }, { status: 500 })
  }

  try {
    const parsed = JSON.parse(match[0]) as { status?: string; reason?: string }
    const status = parsed.status?.trim()
    if (!status || !VALID_STATUSES.has(status)) {
      return NextResponse.json({ ok: false, error: 'Invalid status returned', raw: parsed }, { status: 500 })
    }
    return NextResponse.json({ ok: true, suggested_status: status, reason: parsed.reason ?? '' })
  } catch {
    return NextResponse.json({ ok: false, error: 'Failed to parse JSON' }, { status: 500 })
  }
}
