export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
import { FhIntegrationsClient, type PendingFhEmail } from '@/components/fh-integrations-client'
import { parseFhIntegrationEmail } from '@/lib/fh-integration-parser'

export default async function FareHarborPage() {
  const supabase = createServiceClient()

  // Pending source: emails flagged by sync (template-shaped FH form submissions)
  // or manually flagged via /api/fareharbor/flag-email, that haven't been converted yet.
  const [integrationsRes, flaggedRes] = await Promise.all([
    supabase
      .from('fh_integrations')
      .select('*, customers(id, name, company)')
      .order('created_at', { ascending: false }),
    supabase
      .from('interactions')
      .select('id, subject, content, occurred_at, customer_id, metadata, customers(id, name, company, customer_identifiers(type, value, is_primary))')
      .eq('metadata->>fh_integration_request', 'true')
      .is('metadata->>fh_integration_id', null)
      .order('occurred_at', { ascending: false }),
  ])

  type Identifier = { type: string; value: string; is_primary: boolean }
  type CustomerWithIds = { id: string; name: string; company: string | null; customer_identifiers?: Identifier[] }
  type FhIntegrationRow = { email: string | null; customer_id: string | null }

  type Raw = {
    id: string
    subject: string | null
    content: string | null
    occurred_at: string
    metadata: Record<string, unknown> | null
    customers?: CustomerWithIds | CustomerWithIds[] | null
  }

  function flattenCustomer(c: Raw['customers']): CustomerWithIds | null {
    if (!c) return null
    return Array.isArray(c) ? c[0] ?? null : c
  }

  function primaryEmail(c: CustomerWithIds | null): string | null {
    if (!c?.customer_identifiers) return null
    const list = c.customer_identifiers.filter((i) => i.type === 'email')
    const primary = list.find((i) => i.is_primary)
    return (primary?.value ?? list[0]?.value ?? null)?.toLowerCase().trim() ?? null
  }

  // Dedup sets from existing integrations.
  // Only block on exact email match + customer_id match. Company/domain dedup
  // was previously needed to filter Re: confirmation replies that quoted the
  // form template — but now isFhIntegrationEmail() requires the sender to be
  // site@kapta.pt, so quoted replies are no longer flagged at sync time. Form
  // submissions for already-integrated companies (e.g. partner re-submitting
  // the form) are intentionally surfaced so Pedro sees the duplicate.
  const existingEmails = new Set<string>()
  const existingCustomerIds = new Set<string>()
  for (const i of (integrationsRes.data ?? []) as FhIntegrationRow[]) {
    if (i.email) existingEmails.add(i.email.toLowerCase().trim())
    if (i.customer_id) existingCustomerIds.add(i.customer_id)
  }

  // Dedup by interaction id (one source now, but defensive)
  const seenInteractions = new Set<string>()
  const candidates: Raw[] = []
  for (const r of (flaggedRes.data ?? []) as Raw[]) {
    if (seenInteractions.has(r.id)) continue
    seenInteractions.add(r.id); candidates.push(r)
  }

  candidates.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())

  // Group candidates by sender email and MERGE parsed fields across all matches.
  // First non-null wins per field — so an older form-template email with "Name: Antonia Grimalt"
  // contributes the name, while the newest reply contributes the subject + interaction_id.
  type Acc = PendingFhEmail & { _occurred_ms: number }
  const bySender = new Map<string, Acc>()

  for (const row of candidates) {
    const md     = (row.metadata ?? {}) as Record<string, unknown>
    const flagged = !!md.fh_integration_request
    const parsedRaw = (md.fh_parsed as Record<string, unknown> | undefined)
      ?? (parseFhIntegrationEmail(row.content) as unknown as Record<string, unknown>)

    const customer = flattenCustomer(row.customers)

    const parsedEmail = ((parsedRaw.email as string | undefined) ?? '').toLowerCase().trim()
    const senderEmail = parsedEmail || primaryEmail(customer) || ''
    if (!senderEmail) continue
    if (/@kapta\.pt$/i.test(senderEmail)) continue
    if (existingEmails.has(senderEmail)) continue
    if (customer?.id && existingCustomerIds.has(customer.id)) continue

    const fwCustomer = customer ? { id: customer.id, name: customer.name, company: customer.company } : null
    const occurredMs = new Date(row.occurred_at).getTime()
    const parsedName       = (parsedRaw.name as string | undefined)?.trim() || null
    const parsedShortname  = (parsedRaw.shortname as string | undefined)?.trim() || null
    const parsedCountry    = (parsedRaw.country as string | undefined)?.trim() || null
    const parsedInvoicing  = (parsedRaw.invoicingSystem as string | undefined)?.trim() || null
    const parsedAuth       = parsedRaw.authorization as boolean | undefined

    const existing = bySender.get(senderEmail)
    if (!existing) {
      bySender.set(senderEmail, {
        interaction_id:    row.id,
        occurred_at:       row.occurred_at,
        subject:           row.subject,
        name:              parsedName ?? customer?.name ?? null,
        email:             senderEmail,
        country:           parsedCountry,
        invoicing_system:  parsedInvoicing,
        shortname:         parsedShortname,
        authorization:     parsedAuth ?? null,
        parsed:            parsedRaw,
        forwarded_to_customer: fwCustomer,
        legacy:            !flagged,
        _occurred_ms:      occurredMs,
      })
      continue
    }

    // Newer than current? Bump interaction_id + subject + occurred_at (we want the latest thread state).
    if (occurredMs > existing._occurred_ms) {
      existing.interaction_id = row.id
      existing.occurred_at    = row.occurred_at
      existing.subject        = row.subject
      existing._occurred_ms   = occurredMs
      if (!existing.forwarded_to_customer) existing.forwarded_to_customer = fwCustomer
      if (!existing.legacy && !flagged) existing.legacy = true
    }

    // Fill in any missing parsed fields from this candidate. First non-null wins overall;
    // we only override when current is null.
    if (!existing.name             && parsedName)      existing.name = parsedName
    if (!existing.shortname        && parsedShortname) existing.shortname = parsedShortname
    if (!existing.country          && parsedCountry)   existing.country = parsedCountry
    if (!existing.invoicing_system && parsedInvoicing) existing.invoicing_system = parsedInvoicing
    if (existing.authorization == null && parsedAuth !== undefined) existing.authorization = parsedAuth
    // Merge parsed JSON shallowly (richer parsed wins per-key)
    existing.parsed = { ...parsedRaw, ...existing.parsed }
  }

  // Newest-first by latest interaction in the thread
  const pending: PendingFhEmail[] = Array.from(bySender.values())
    .sort((a, b) => b._occurred_ms - a._occurred_ms)
    .map(({ _occurred_ms: _, ...rest }) => { void _; return rest })

  return <FhIntegrationsClient rows={integrationsRes.data ?? []} pending={pending} />
}
