import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

/**
 * Lightweight count of FH "Por contactar" items — flagged sync metadata
 * OR inbound emails mentioning FareHarbor, minus emails whose senders
 * already have an fh_integrations row. Used by the sidebar badge.
 *
 * Returns { count } with at-most one mid-cost query path. We use approximate
 * counting (no per-row parsing on this endpoint) — UI accepts ±1.
 */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  const supabase = createServiceClient()

  // Existing integration emails — exclude any inbound whose sender is already linked
  const { data: integrations } = await supabase
    .from('fh_integrations')
    .select('email, customer_id')

  const existingEmails = new Set<string>()
  const existingCustomerIds = new Set<string>()
  for (const i of integrations ?? []) {
    if (i.email) existingEmails.add(i.email.toLowerCase().trim())
    if (i.customer_id) existingCustomerIds.add(i.customer_id)
  }

  // Pending inbound emails: flagged by sync OR body mentions fareharbor
  const { data: rows } = await supabase
    .from('interactions')
    .select('customer_id, metadata, customers(customer_identifiers(type, value, is_primary))')
    .eq('type', 'email')
    .eq('direction', 'inbound')
    .or('metadata->>fh_integration_request.eq.true,subject.ilike.%fareharbor%,subject.ilike.%fare harbor%,subject.ilike.%fareharbour%,content.ilike.%fareharbor%,content.ilike.%fareharbour%,content.ilike.%fare harbor%')
    .order('occurred_at', { ascending: false })
    .limit(1500)

  type Identifier = { type: string; value: string; is_primary: boolean }
  type CustomerWithIds = { customer_identifiers?: Identifier[] }

  const seenSenders = new Set<string>()
  let count = 0
  for (const r of rows ?? []) {
    const md = (r.metadata ?? {}) as Record<string, unknown>
    if (md.fh_integration_id) continue
    if (r.customer_id && existingCustomerIds.has(r.customer_id)) continue

    // Determine sender email — parsed body email > customer primary email
    const parsedEmail = ((md.fh_parsed as Record<string, unknown> | undefined)?.email as string | undefined)?.toLowerCase().trim()
    let senderEmail = parsedEmail || ''
    if (!senderEmail) {
      const cust = r.customers as CustomerWithIds | CustomerWithIds[] | null
      const c = Array.isArray(cust) ? cust[0] : cust
      const ids = c?.customer_identifiers?.filter((i) => i.type === 'email') ?? []
      const primary = ids.find((i) => i.is_primary)
      senderEmail = (primary?.value ?? ids[0]?.value ?? '').toLowerCase().trim()
    }
    if (!senderEmail) continue
    if (/@kapta\.pt$/i.test(senderEmail)) continue
    if (existingEmails.has(senderEmail)) continue
    if (seenSenders.has(senderEmail)) continue
    seenSenders.add(senderEmail)
    count++
  }

  return NextResponse.json({ count })
}
