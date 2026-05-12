export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
import { FhIntegrationsClient, type PendingFhEmail } from '@/components/fh-integrations-client'
import { parseFhIntegrationEmail } from '@/lib/fh-integration-parser'

export default async function FareHarborPage() {
  const supabase = createServiceClient()

  // Three queries:
  //   integrations   — existing fh_integrations rows
  //   flaggedRes     — emails marked by sync (metadata.fh_integration_request)
  //   contentRes     — broader: any inbound email mentioning "fareharbor" in subject/body
  //                    (covers legacy form requests AND ongoing FH-related conversations
  //                    that aren't structured form submissions)
  const [integrationsRes, flaggedRes, contentRes] = await Promise.all([
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
    supabase
      .from('interactions')
      .select('id, subject, content, occurred_at, direction, customer_id, metadata, customers(id, name, company, customer_identifiers(type, value, is_primary))')
      .eq('type', 'email')
      .eq('direction', 'inbound')
      .or('subject.ilike.%fareharbor%,subject.ilike.%fare harbor%,subject.ilike.%fareharbour%,content.ilike.%fareharbor%,content.ilike.%fareharbour%,content.ilike.%fare harbor%')
      .order('occurred_at', { ascending: false })
      .limit(1000),
  ])

  type Identifier = { type: string; value: string; is_primary: boolean }
  type CustomerWithIds = { id: string; name: string; company: string | null; customer_identifiers?: Identifier[] }
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

  // Dedup sets from existing integrations
  const existingEmails = new Set<string>()
  const existingCustomerIds = new Set<string>()
  for (const i of integrationsRes.data ?? []) {
    if (i.email) existingEmails.add(i.email.toLowerCase().trim())
    if (i.customer_id) existingCustomerIds.add(i.customer_id)
  }

  // Merge candidates, dedup by interaction id
  const seenInteractions = new Set<string>()
  const candidates: Raw[] = []
  for (const r of (flaggedRes.data ?? []) as Raw[]) {
    if (seenInteractions.has(r.id)) continue
    seenInteractions.add(r.id); candidates.push(r)
  }
  for (const r of (contentRes.data ?? []) as Raw[]) {
    if (seenInteractions.has(r.id)) continue
    const md = (r.metadata ?? {}) as Record<string, unknown>
    if (md.fh_integration_id) continue // already converted
    seenInteractions.add(r.id); candidates.push(r)
  }

  candidates.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())

  const pending: PendingFhEmail[] = []
  const seenSenderEmails = new Set<string>()

  for (const row of candidates) {
    const md     = (row.metadata ?? {}) as Record<string, unknown>
    const flagged = !!md.fh_integration_request
    const parsedRaw = (md.fh_parsed as Record<string, unknown> | undefined)
      ?? (parseFhIntegrationEmail(row.content) as unknown as Record<string, unknown>)

    const customer = flattenCustomer(row.customers)

    // Partner email: prefer the parsed body email; fallback to the customer's primary email identifier.
    const parsedEmail = ((parsedRaw.email as string | undefined) ?? '').toLowerCase().trim()
    const senderEmail = parsedEmail || primaryEmail(customer) || ''
    const parsedShortname = ((parsedRaw.shortname as string | undefined) ?? '').trim()

    if (!senderEmail) continue // can't identify partner
    if (/@kapta\.pt$/i.test(senderEmail)) continue // skip internal
    if (existingEmails.has(senderEmail)) continue
    if (customer?.id && existingCustomerIds.has(customer.id)) continue
    if (seenSenderEmails.has(senderEmail)) continue
    seenSenderEmails.add(senderEmail)

    // Strip identifiers from forwarded_to_customer (the client only needs id/name/company)
    const fwCustomer = customer ? { id: customer.id, name: customer.name, company: customer.company } : null

    pending.push({
      interaction_id:    row.id,
      occurred_at:       row.occurred_at,
      subject:           row.subject,
      name:              (parsedRaw.name as string | undefined) ?? customer?.name ?? null,
      email:             senderEmail,
      country:           (parsedRaw.country as string | undefined) ?? null,
      invoicing_system:  (parsedRaw.invoicingSystem as string | undefined) ?? null,
      shortname:         parsedShortname || null,
      authorization:     (parsedRaw.authorization as boolean | undefined) ?? null,
      parsed:            parsedRaw,
      forwarded_to_customer: fwCustomer,
      legacy:            !flagged,
    })
  }

  return <FhIntegrationsClient rows={integrationsRes.data ?? []} pending={pending} />
}
