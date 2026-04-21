import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { createServiceClient } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const INTERNAL_DOMAIN = 'kapta.pt'

type SlackEvent = {
  type: string
  subtype?: string
  user?: string
  text?: string
  channel?: string
  ts?: string
  thread_ts?: string
  files?: unknown[]
  bot_id?: string
}

type SlackEnvelope = {
  type: 'url_verification' | 'event_callback' | string
  challenge?: string
  team_id?: string
  event?: SlackEvent
}

type SlackUserInfo = {
  id: string
  real_name?: string
  profile?: { email?: string; real_name?: string; display_name?: string }
}

function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  signingSecret: string
): boolean {
  if (!timestamp || !signature) return false
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false

  const base = `v0:${timestamp}:${rawBody}`
  const computed = 'v0=' + createHmac('sha256', signingSecret).update(base).digest('hex')
  const a = Buffer.from(computed)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

async function fetchSlackUser(userId: string, botToken: string): Promise<SlackUserInfo | null> {
  try {
    const res = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${botToken}` },
      cache: 'no-store',
    })
    const json = (await res.json()) as { ok: boolean; user?: SlackUserInfo }
    if (!json.ok || !json.user) return null
    return json.user
  } catch {
    return null
  }
}

function resolveBotToken(teamId: string | undefined): string | null {
  if (!teamId) return process.env.SLACK_BOT_TOKEN_KAPTA_PT ?? null
  const byTeam = process.env[`SLACK_BOT_TOKEN_TEAM_${teamId}`]
  if (byTeam) return byTeam
  return process.env.SLACK_BOT_TOKEN_KAPTA_PT ?? null
}

export async function POST(req: NextRequest) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET
  if (!signingSecret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const rawBody = await req.text()
  const ts = req.headers.get('x-slack-request-timestamp')
  const sig = req.headers.get('x-slack-signature')

  if (!verifySlackSignature(rawBody, ts, sig, signingSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: SlackEnvelope
  try {
    body = JSON.parse(rawBody) as SlackEnvelope
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.type === 'url_verification' && body.challenge) {
    return new NextResponse(body.challenge, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    })
  }

  if (body.type !== 'event_callback' || !body.event) {
    return NextResponse.json({ ok: true })
  }

  const event = body.event
  const teamId = body.team_id

  if (event.type !== 'message') {
    return NextResponse.json({ ok: true })
  }

  const skipSubtypes = new Set([
    'bot_message',
    'message_changed',
    'message_deleted',
    'channel_join',
    'channel_leave',
    'channel_topic',
    'channel_purpose',
    'channel_name',
    'pinned_item',
    'unpinned_item',
  ])
  if (event.subtype && skipSubtypes.has(event.subtype)) {
    return NextResponse.json({ ok: true, skipped: event.subtype })
  }
  if (event.bot_id) {
    return NextResponse.json({ ok: true, skipped: 'bot_id' })
  }
  if (!event.user || !event.ts || !event.channel) {
    return NextResponse.json({ ok: true, skipped: 'missing_fields' })
  }

  const botToken = resolveBotToken(teamId)
  if (!botToken) {
    console.warn('[slack/webhook] no bot token for team', teamId)
    return NextResponse.json({ ok: true, skipped: 'no_token' })
  }

  const userInfo = await fetchSlackUser(event.user, botToken)
  const email = userInfo?.profile?.email?.toLowerCase().trim() ?? null
  const displayName =
    userInfo?.profile?.display_name ||
    userInfo?.profile?.real_name ||
    userInfo?.real_name ||
    event.user

  if (!email) {
    console.log('[slack/webhook] skip: no email on user', event.user)
    return NextResponse.json({ ok: true, skipped: 'no_email' })
  }

  const isInternal = email.endsWith('@' + INTERNAL_DOMAIN)
  const supabase = createServiceClient()

  const { data: idRow } = await supabase
    .from('customer_identifiers')
    .select('customer_id')
    .eq('value', email)
    .limit(1)
    .maybeSingle()

  let customerId: string | null = idRow?.customer_id ?? null
  let matchSource: 'user_email' | 'channel_map' | 'auto_created' = 'user_email'

  if (!customerId) {
    const { data: channelRow } = await supabase
      .from('customer_identifiers')
      .select('customer_id')
      .eq('type', 'slack_channel')
      .eq('value', event.channel)
      .limit(1)
      .maybeSingle()

    if (channelRow?.customer_id) {
      customerId = channelRow.customer_id
      matchSource = 'channel_map'
    }
  }

  if (!customerId && isInternal) {
    console.log('[slack/webhook] skip: internal sender, no user match, no channel map', email, event.channel)
    return NextResponse.json({ ok: true, skipped: 'internal_no_context' })
  }

  if (!customerId) {
    const { data: newCustomer, error: insErr } = await supabase
      .from('customers')
      .insert({ name: displayName || email.split('@')[0], status: 'onboarding', health_score: 3 })
      .select('id')
      .single()

    if (insErr || !newCustomer) {
      console.error('[slack/webhook] failed to auto-create customer', insErr)
      return NextResponse.json({ ok: true, skipped: 'create_failed' })
    }

    await supabase.from('customer_identifiers').insert({
      customer_id: newCustomer.id,
      type: 'email',
      value: email,
      is_primary: true,
    })

    customerId = newCustomer.id
    matchSource = 'auto_created'
  }

  const occurredAt = new Date(parseFloat(event.ts) * 1000).toISOString()
  const sourceId = `slack:${teamId ?? 'unknown'}:${event.channel}:${event.ts}`

  const row = {
    customer_id: customerId,
    type: 'slack' as const,
    direction: (isInternal ? 'outbound' : 'inbound') as 'inbound' | 'outbound',
    subject: null,
    content: (event.text ?? '').slice(0, 4000) || null,
    source_id: sourceId,
    metadata: {
      slack_team_id: teamId ?? null,
      slack_channel: event.channel,
      slack_user: event.user,
      slack_user_name: displayName,
      slack_user_email: email,
      thread_ts: event.thread_ts ?? null,
      files: event.files ?? [],
      match_source: matchSource,
    },
    occurred_at: occurredAt,
  }

  const { error: upsertErr } = await supabase
    .from('interactions')
    .upsert(row, { onConflict: 'source_id', ignoreDuplicates: true })

  if (upsertErr) {
    console.error('[slack/webhook] upsert failed', upsertErr)
    return NextResponse.json({ ok: false }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
