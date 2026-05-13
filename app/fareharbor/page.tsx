export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
import { FhIntegrationsClient, type PendingFhEmail } from '@/components/fh-integrations-client'
import { parseFhIntegrationEmail } from '@/lib/fh-integration-parser'
import { fetchFhAdminClients, type FhAdminClient } from '@/lib/fh-admin-client'
import { normalizeFhCountry } from '@/lib/database.types'

export default async function FareHarborPage() {
  const supabase = createServiceClient()

  // Endpoint pull runs alongside the DB queries; failures don't block the page,
  // they fall back to email-only pending list with a banner.
  let adminClients: FhAdminClient[] = []
  let endpointError: string | null = null

  const [integrationsRes, flaggedRes, adminRes] = await Promise.all([
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
    fetchFhAdminClients().catch((e: unknown) => {
      endpointError = e instanceof Error ? e.message : 'Erro a carregar pedidos do admin.'
      return [] as FhAdminClient[]
    }),
  ])
  adminClients = adminRes

  type Identifier = { type: string; value: string; is_primary: boolean }
  type CustomerWithIds = { id: string; name: string; company: string | null; customer_identifiers?: Identifier[] }
  type FhIntegrationRow = { email: string | null; customer_id: string | null; shortname: string }

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

  // ── Dedup sets from already-converted integrations ──────────────────────
  const existingEmails      = new Set<string>()
  const existingCustomerIds = new Set<string>()
  const existingShortnames  = new Set<string>()
  for (const i of (integrationsRes.data ?? []) as FhIntegrationRow[]) {
    if (i.email)     existingEmails.add(i.email.toLowerCase().trim())
    if (i.customer_id) existingCustomerIds.add(i.customer_id)
    if (i.shortname) existingShortnames.add(i.shortname.toLowerCase().trim())
  }

  // ── Build parsed candidate set from flagged interactions (per sender) ───
  type Parsed = {
    interaction_id: string
    occurred_at:    string
    occurred_ms:    number
    subject:        string | null
    name:           string | null
    email:          string | null
    shortname:      string | null
    country:        string | null
    invoicing_system: string | null
    authorization:  boolean | null
    parsed:         Record<string, unknown>
    forwarded:      { id: string; name: string; company: string | null } | null
  }

  const seen = new Set<string>()
  const flaggedRows: Raw[] = []
  for (const r of (flaggedRes.data ?? []) as Raw[]) {
    if (seen.has(r.id)) continue
    seen.add(r.id); flaggedRows.push(r)
  }
  flaggedRows.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())

  // Group flagged interactions by sender email, merging fields across the thread.
  const flaggedByEmail = new Map<string, Parsed>()
  const flaggedByShortname = new Map<string, Parsed>()

  for (const row of flaggedRows) {
    const md       = (row.metadata ?? {}) as Record<string, unknown>
    const parsedRaw = (md.fh_parsed as Record<string, unknown> | undefined)
      ?? (parseFhIntegrationEmail(row.content) as unknown as Record<string, unknown>)

    const customer = flattenCustomer(row.customers)
    const parsedEmail = ((parsedRaw.email as string | undefined) ?? '').toLowerCase().trim()
    const senderEmail = parsedEmail || primaryEmail(customer) || ''
    if (!senderEmail) continue
    if (/@kapta\.pt$/i.test(senderEmail)) continue

    const parsedName       = (parsedRaw.name as string | undefined)?.trim() || null
    const parsedShortname  = (parsedRaw.shortname as string | undefined)?.trim() || null
    const parsedCountry    = (parsedRaw.country as string | undefined)?.trim() || null
    const parsedInvoicing  = (parsedRaw.invoicingSystem as string | undefined)?.trim() || null
    const parsedAuth       = parsedRaw.authorization as boolean | undefined
    const occurredMs       = new Date(row.occurred_at).getTime()
    const forwarded = customer ? { id: customer.id, name: customer.name, company: customer.company } : null

    const existing = flaggedByEmail.get(senderEmail)
    if (!existing) {
      const entry: Parsed = {
        interaction_id: row.id,
        occurred_at:    row.occurred_at,
        occurred_ms:    occurredMs,
        subject:        row.subject,
        name:           parsedName ?? customer?.name ?? null,
        email:          senderEmail,
        shortname:      parsedShortname,
        country:        parsedCountry,
        invoicing_system: parsedInvoicing,
        authorization:  parsedAuth ?? null,
        parsed:         parsedRaw,
        forwarded,
      }
      flaggedByEmail.set(senderEmail, entry)
      if (parsedShortname) flaggedByShortname.set(parsedShortname.toLowerCase(), entry)
      continue
    }

    if (occurredMs > existing.occurred_ms) {
      existing.interaction_id = row.id
      existing.occurred_at    = row.occurred_at
      existing.occurred_ms    = occurredMs
      existing.subject        = row.subject
      if (!existing.forwarded) existing.forwarded = forwarded
    }
    if (!existing.name             && parsedName)      existing.name = parsedName
    if (!existing.shortname        && parsedShortname) {
      existing.shortname = parsedShortname
      flaggedByShortname.set(parsedShortname.toLowerCase(), existing)
    }
    if (!existing.country          && parsedCountry)   existing.country = parsedCountry
    if (!existing.invoicing_system && parsedInvoicing) existing.invoicing_system = parsedInvoicing
    if (existing.authorization == null && parsedAuth !== undefined) existing.authorization = parsedAuth
    existing.parsed = { ...parsedRaw, ...existing.parsed }
  }

  // ── Build pending list: endpoint records first, then orphan emails ──────
  const matchedFlaggedIds = new Set<string>()
  const pending: PendingFhEmail[] = []

  for (const c of adminClients) {
    const shortnameLc = c.shortname.toLowerCase().trim()
    const emailLc     = (c.email ?? '').toLowerCase().trim()

    // Suppress if already converted (by shortname, email, or via flagged interaction's linked customer).
    if (existingShortnames.has(shortnameLc)) continue
    if (emailLc && existingEmails.has(emailLc)) continue

    const match = (emailLc && flaggedByEmail.get(emailLc))
               || flaggedByShortname.get(shortnameLc)
               || null
    if (match) matchedFlaggedIds.add(match.interaction_id)

    if (match?.forwarded && existingCustomerIds.has(match.forwarded.id)) continue

    pending.push({
      interaction_id:    match?.interaction_id ?? null,
      occurred_at:       match?.occurred_at ?? c.data_criacao,
      subject:           match?.subject ?? null,
      name:              c.nome || match?.name || null,
      email:             emailLc || match?.email || null,
      country:           c.pais || match?.country || null,
      invoicing_system:  c.sistema || match?.invoicing_system || null,
      shortname:         c.shortname || match?.shortname || null,
      authorization:     c.autorizado === 1,
      parsed:            (match?.parsed ?? {}) as Record<string, unknown>,
      forwarded_to_customer: match?.forwarded ?? null,
      legacy:            false,
      fh_admin_id:       c.id,
      submitted_at:      c.data_criacao,
      from_endpoint:     true,
      from_email:        !!match,
    })
  }

  // Orphan emails: flagged interactions with no endpoint match.
  for (const entry of flaggedByEmail.values()) {
    if (matchedFlaggedIds.has(entry.interaction_id)) continue
    if (existingEmails.has(entry.email!)) continue
    if (entry.forwarded?.id && existingCustomerIds.has(entry.forwarded.id)) continue

    pending.push({
      interaction_id:    entry.interaction_id,
      occurred_at:       entry.occurred_at,
      subject:           entry.subject,
      name:              entry.name,
      email:             entry.email,
      country:           entry.country,
      invoicing_system:  entry.invoicing_system,
      shortname:         entry.shortname,
      authorization:     entry.authorization,
      parsed:            entry.parsed,
      forwarded_to_customer: entry.forwarded,
      legacy:            true,
      fh_admin_id:       null,
      submitted_at:      null,
      from_endpoint:     false,
      from_email:        true,
    })
  }

  // Sort: endpoint+email (best) → endpoint-only → email-only.
  // Within each group, newest first by submitted_at or occurred_at.
  function sortRank(p: PendingFhEmail): number {
    if (p.from_endpoint && p.from_email) return 0
    if (p.from_endpoint) return 1
    return 2
  }
  function sortTime(p: PendingFhEmail): number {
    const t = p.submitted_at ?? p.occurred_at
    return t ? new Date(t).getTime() : 0
  }
  pending.sort((a, b) => {
    const r = sortRank(a) - sortRank(b)
    if (r !== 0) return r
    return sortTime(b) - sortTime(a)
  })

  // Apply country normalisation hint so client can map directly to FH_COUNTRY_LABELS.
  for (const p of pending) {
    if (p.country) {
      const normalized = normalizeFhCountry(p.country)
      if (normalized) p.country = normalized
    }
  }

  return (
    <FhIntegrationsClient
      rows={integrationsRes.data ?? []}
      pending={pending}
      endpointError={endpointError}
    />
  )
}
