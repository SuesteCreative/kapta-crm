import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

/**
 * Lightweight count of FH "Por contactar" items — interactions flagged
 * (metadata.fh_integration_request = true) that haven't been converted yet,
 * minus senders already linked to an existing fh_integrations row.
 * Used by the sidebar badge.
 */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  const supabase = createServiceClient()

  function normalizeCompanyName(name: string | null | undefined): string | null {
    if (!name) return null
    const v = name.trim().toLowerCase().replace(/\s+/g, ' ')
    return v ? v : null
  }

  // Existing integration sets (must mirror page.tsx dedup logic exactly)
  const { data: integrations } = await supabase
    .from('fh_integrations')
    .select('email, customer_id, customers(company, company_id)')

  const PERSONAL_DOMAINS = new Set([
    'gmail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com',
    'icloud.com', 'me.com', 'aol.com', 'protonmail.com', 'proton.me',
    'sapo.pt', 'iol.pt', 'clix.pt',
  ])
  const existingEmails = new Set<string>()
  const existingCustomerIds = new Set<string>()
  const existingCompanyIds = new Set<string>()
  const existingCompanyNames = new Set<string>()
  const existingDomains = new Set<string>()
  for (const i of integrations ?? []) {
    if (i.email) {
      const e = i.email.toLowerCase().trim()
      existingEmails.add(e)
      const d = e.split('@')[1]
      if (d && !PERSONAL_DOMAINS.has(d)) existingDomains.add(d)
    }
    if (i.customer_id) existingCustomerIds.add(i.customer_id)
    const c = Array.isArray(i.customers) ? i.customers[0] : i.customers
    if (c?.company_id) existingCompanyIds.add(c.company_id)
    const cn = normalizeCompanyName(c?.company)
    if (cn) existingCompanyNames.add(cn)
  }

  // Flagged interactions not yet converted to fh_integrations
  const { data: rows } = await supabase
    .from('interactions')
    .select('customer_id, metadata, customers(company, company_id, customer_identifiers(type, value, is_primary))')
    .eq('metadata->>fh_integration_request', 'true')
    .is('metadata->>fh_integration_id', null)
    .order('occurred_at', { ascending: false })
    .limit(1500)

  type Identifier = { type: string; value: string; is_primary: boolean }
  type CustomerWithIds = { company: string | null; company_id: string | null; customer_identifiers?: Identifier[] }

  const seenSenders = new Set<string>()
  let count = 0
  for (const r of rows ?? []) {
    const md = (r.metadata ?? {}) as Record<string, unknown>
    if (md.fh_integration_id) continue
    if (r.customer_id && existingCustomerIds.has(r.customer_id)) continue

    const cust = r.customers as CustomerWithIds | CustomerWithIds[] | null
    const c = Array.isArray(cust) ? cust[0] : cust
    if (c?.company_id && existingCompanyIds.has(c.company_id)) continue
    const candidateCompanyName = normalizeCompanyName(c?.company)
    if (candidateCompanyName && existingCompanyNames.has(candidateCompanyName)) continue

    // Determine sender email — parsed body email > customer primary email
    const parsedEmail = ((md.fh_parsed as Record<string, unknown> | undefined)?.email as string | undefined)?.toLowerCase().trim()
    let senderEmail = parsedEmail || ''
    if (!senderEmail) {
      const ids = c?.customer_identifiers?.filter((i) => i.type === 'email') ?? []
      const primary = ids.find((i) => i.is_primary)
      senderEmail = (primary?.value ?? ids[0]?.value ?? '').toLowerCase().trim()
    }
    if (!senderEmail) continue
    if (/@kapta\.pt$/i.test(senderEmail)) continue
    if (existingEmails.has(senderEmail)) continue
    const senderDomain = senderEmail.split('@')[1]
    if (senderDomain && !PERSONAL_DOMAINS.has(senderDomain) && existingDomains.has(senderDomain)) continue
    if (seenSenders.has(senderEmail)) continue
    seenSenders.add(senderEmail)
    count++
  }

  return NextResponse.json({ count })
}
