export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
import { FhIntegrationsClient, type PendingFhEmail } from '@/components/fh-integrations-client'
import { parseFhIntegrationEmail } from '@/lib/fh-integration-parser'

export default async function FareHarborPage() {
  const supabase = createServiceClient()

  // Pull active integrations + every email that looks like a FH form request.
  // We accept BOTH paths:
  //   (a) emails flagged by sync (metadata.fh_integration_request = true)
  //   (b) legacy emails whose content matches the FH form template
  //       (FareHarbor Shortname + Email lines) — parsed on the fly here.
  // De-dupe by interaction id and drop any already linked to an fh_integration.
  const [integrationsRes, flaggedRes, contentRes] = await Promise.all([
    supabase
      .from('fh_integrations')
      .select('*, customers(id, name, company)')
      .order('created_at', { ascending: false }),
    supabase
      .from('interactions')
      .select('id, subject, content, occurred_at, customer_id, metadata, customers(id, name, company)')
      .eq('metadata->>fh_integration_request', 'true')
      .is('metadata->>fh_integration_id', null)
      .order('occurred_at', { ascending: false }),
    // Multi-pattern detection: catches legacy emails with varied label formats
    // ("FareHarbor Shortname:", "FH Shortname:", "Shortname:", PT labels, "-/—" separators).
    supabase
      .from('interactions')
      .select('id, subject, content, occurred_at, customer_id, metadata, customers(id, name, company)')
      .eq('type', 'email')
      .or([
        'content.ilike.%FareHarbor Shortname%',
        'content.ilike.%FH Shortname%',
        'content.ilike.%Shortname%fareharbor%',
        'content.ilike.%fareharbor%Shortname%',
        'subject.ilike.%FareHarbor%integration%',
        'subject.ilike.%integração FareHarbor%',
        'subject.ilike.%pedido%FareHarbor%',
      ].join(','))
      .order('occurred_at', { ascending: false })
      .limit(800),
  ])

  type Raw = {
    id: string
    subject: string | null
    content: string | null
    occurred_at: string
    metadata: Record<string, unknown> | null
    customers?: { id: string; name: string; company: string | null } | { id: string; name: string; company: string | null }[] | null
  }

  // Build dedup sets from existing integrations:
  // (1) emails — any pending whose parsed email matches an integration is dropped
  // (2) customer_ids — any pending whose linked customer already has an integration is dropped
  const existingEmails = new Set<string>()
  const existingCustomerIds = new Set<string>()
  for (const i of integrationsRes.data ?? []) {
    if (i.email) existingEmails.add(i.email.toLowerCase().trim())
    if (i.customer_id) existingCustomerIds.add(i.customer_id)
  }

  const seen = new Set<string>()
  const candidates: Raw[] = []
  for (const r of (flaggedRes.data ?? []) as Raw[]) {
    if (seen.has(r.id)) continue
    seen.add(r.id); candidates.push(r)
  }
  for (const r of (contentRes.data ?? []) as Raw[]) {
    if (seen.has(r.id)) continue
    const md = (r.metadata ?? {}) as Record<string, unknown>
    if (md.fh_integration_id) continue // already converted
    seen.add(r.id); candidates.push(r)
  }

  // Sort newest-first
  candidates.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())

  const pending: PendingFhEmail[] = []
  const seenEmails = new Set<string>()

  for (const row of candidates) {
    const md     = (row.metadata ?? {}) as Record<string, unknown>
    const flagged = !!md.fh_integration_request
    const parsedRaw = (md.fh_parsed as Record<string, unknown> | undefined)
      ?? (parseFhIntegrationEmail(row.content) as unknown as Record<string, unknown>)

    const cust = (row as Raw).customers
    const customer = Array.isArray(cust) ? cust[0] ?? null : cust ?? null

    const parsedEmail = ((parsedRaw.email as string | undefined) ?? '').toLowerCase().trim()
    const parsedShortname = ((parsedRaw.shortname as string | undefined) ?? '').trim()

    // Skip if parser yielded no usable data (broader ilike pulls some non-FH emails)
    if (!parsedEmail && !parsedShortname) continue
    // Skip if the parsed email is internal (forwarded internal trash, not a real partner)
    if (parsedEmail && /@kapta\.pt$/i.test(parsedEmail)) continue

    // Dedup against existing integrations
    if (parsedEmail && existingEmails.has(parsedEmail)) continue
    if (customer?.id && existingCustomerIds.has(customer.id)) continue
    // Dedup pending candidates with the same parsed email (multiple forwards of same request)
    if (parsedEmail && seenEmails.has(parsedEmail)) continue
    if (parsedEmail) seenEmails.add(parsedEmail)

    pending.push({
      interaction_id:    row.id,
      occurred_at:       row.occurred_at,
      subject:           row.subject,
      name:              (parsedRaw.name as string | undefined) ?? null,
      email:             (parsedRaw.email as string | undefined) ?? null,
      country:           (parsedRaw.country as string | undefined) ?? null,
      invoicing_system:  (parsedRaw.invoicingSystem as string | undefined) ?? null,
      shortname:         (parsedRaw.shortname as string | undefined) ?? null,
      authorization:     (parsedRaw.authorization as boolean | undefined) ?? null,
      parsed:            parsedRaw,
      forwarded_to_customer: customer,
      legacy:            !flagged,
    })
  }

  return <FhIntegrationsClient rows={integrationsRes.data ?? []} pending={pending} />
}
