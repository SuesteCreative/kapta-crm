import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/api-auth'
import { fetchFhAdminClients, type FhAdminClient } from '@/lib/fh-admin-client'

export const dynamic = 'force-dynamic'

/**
 * Count of FH "Por contactar" items — endpoint submissions plus orphaned
 * email-flagged interactions, minus anything already in fh_integrations.
 * Must mirror app/fareharbor/page.tsx dedup so the sidebar badge matches.
 */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  const supabase = createServiceClient()

  const { data: integrations } = await supabase
    .from('fh_integrations')
    .select('email, customer_id, shortname')

  const existingEmails      = new Set<string>()
  const existingCustomerIds = new Set<string>()
  const existingShortnames  = new Set<string>()
  for (const i of integrations ?? []) {
    if (i.email)     existingEmails.add(i.email.toLowerCase().trim())
    if (i.customer_id) existingCustomerIds.add(i.customer_id)
    if (i.shortname) existingShortnames.add(i.shortname.toLowerCase().trim())
  }

  // Endpoint pull — failures count as zero (page.tsx will show banner separately).
  let admin: FhAdminClient[] = []
  try { admin = await fetchFhAdminClients() } catch { admin = [] }

  const { data: rows } = await supabase
    .from('interactions')
    .select('customer_id, metadata, customers(customer_identifiers(type, value, is_primary))')
    .eq('metadata->>fh_integration_request', 'true')
    .is('metadata->>fh_integration_id', null)
    .order('occurred_at', { ascending: false })
    .limit(1500)

  type Identifier = { type: string; value: string; is_primary: boolean }
  type CustomerWithIds = { customer_identifiers?: Identifier[] }

  // Build flagged sender index for cross-matching.
  const flaggedByEmail     = new Set<string>()
  const flaggedByShortname = new Set<string>()
  const orphans: { email: string; customer_id: string | null }[] = []

  const seenSenders = new Set<string>()
  for (const r of rows ?? []) {
    const md = (r.metadata ?? {}) as Record<string, unknown>
    if (md.fh_integration_id) continue

    const parsedRaw = (md.fh_parsed as Record<string, unknown> | undefined) ?? {}
    const parsedEmail = (parsedRaw.email as string | undefined)?.toLowerCase().trim() ?? ''
    const parsedShortname = (parsedRaw.shortname as string | undefined)?.toLowerCase().trim() ?? ''

    let senderEmail = parsedEmail
    if (!senderEmail) {
      const cust = r.customers as CustomerWithIds | CustomerWithIds[] | null
      const c = Array.isArray(cust) ? cust[0] : cust
      const ids = c?.customer_identifiers?.filter((i) => i.type === 'email') ?? []
      const primary = ids.find((i) => i.is_primary)
      senderEmail = (primary?.value ?? ids[0]?.value ?? '').toLowerCase().trim()
    }
    if (!senderEmail) continue
    if (/@kapta\.pt$/i.test(senderEmail)) continue
    if (seenSenders.has(senderEmail)) continue
    seenSenders.add(senderEmail)

    flaggedByEmail.add(senderEmail)
    if (parsedShortname) flaggedByShortname.add(parsedShortname)

    orphans.push({ email: senderEmail, customer_id: r.customer_id ?? null })
  }

  // Count endpoint records that aren't yet integrated.
  const matchedEmails = new Set<string>()
  let count = 0
  for (const c of admin) {
    const shortnameLc = c.shortname.toLowerCase().trim()
    const emailLc     = (c.email ?? '').toLowerCase().trim()
    if (existingShortnames.has(shortnameLc)) continue
    if (emailLc && existingEmails.has(emailLc)) continue
    if (flaggedByEmail.has(emailLc) || flaggedByShortname.has(shortnameLc)) {
      matchedEmails.add(emailLc)
    }
    count++
  }

  // Add orphan emails (flagged but not in endpoint or already integrated).
  for (const o of orphans) {
    if (matchedEmails.has(o.email)) continue
    if (existingEmails.has(o.email)) continue
    if (o.customer_id && existingCustomerIds.has(o.customer_id)) continue
    count++
  }

  return NextResponse.json({ count })
}
