export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
import { FhIntegrationsClient, type PendingFhEmail } from '@/components/fh-integrations-client'

export default async function FareHarborPage() {
  const supabase = createServiceClient()

  const [integrationsRes, pendingRes] = await Promise.all([
    supabase
      .from('fh_integrations')
      .select('*, customers(id, name, company)')
      .order('created_at', { ascending: false }),
    supabase
      .from('interactions')
      .select('id, subject, occurred_at, customer_id, metadata, customers(id, name, company)')
      .eq('metadata->>fh_integration_request', 'true')
      .is('metadata->>fh_integration_id', null)
      .order('occurred_at', { ascending: false }),
  ])

  // Shape pending rows: extract parsed fields so client doesn't need to know metadata structure.
  const pending: PendingFhEmail[] = (pendingRes.data ?? []).map((row) => {
    const md = (row.metadata ?? {}) as Record<string, unknown>
    const parsed = (md.fh_parsed ?? {}) as Record<string, unknown>
    const cust = (row as { customers?: { id: string; name: string; company: string | null } | { id: string; name: string; company: string | null }[] | null }).customers
    const customer = Array.isArray(cust) ? cust[0] ?? null : cust ?? null
    return {
      interaction_id: row.id as string,
      occurred_at:    row.occurred_at as string,
      subject:        row.subject as string | null,
      name:           (parsed.name as string | undefined) ?? null,
      email:          (parsed.email as string | undefined) ?? null,
      country:        (parsed.country as string | undefined) ?? null,
      invoicing_system: (parsed.invoicingSystem as string | undefined) ?? null,
      shortname:      (parsed.shortname as string | undefined) ?? null,
      authorization:  (parsed.authorization as boolean | undefined) ?? null,
      parsed,
      forwarded_to_customer: customer,
    }
  })

  return <FhIntegrationsClient rows={integrationsRes.data ?? []} pending={pending} />
}
