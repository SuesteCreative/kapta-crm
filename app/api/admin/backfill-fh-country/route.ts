import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/api-auth'
import { parseFhIntegrationEmail } from '@/lib/fh-integration-parser'
import { normalizeFhCountry } from '@/lib/database.types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * One-shot backfill: rewrite metadata.fh_parsed (and fh_integrations.country) using
 * the current parser, which now recognises FR/DE/BE/IT/MX/AE/HU/CR. Old syncs stored
 * 'other' (or null) for any non-PT/ES country.
 *
 * POST → { ok, pending_updated, integrations_updated, scanned }
 */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  const supabase = createServiceClient()

  // 1. Pending (flagged but not yet converted) interactions
  const { data: pending, error: pendErr } = await supabase
    .from('interactions')
    .select('id, content, metadata')
    .eq('metadata->>fh_integration_request', 'true')
    .is('metadata->>fh_integration_id', null)
    .limit(2000)

  if (pendErr) return NextResponse.json({ ok: false, error: pendErr.message }, { status: 500 })

  let pendingScanned = 0
  let pendingUpdated = 0
  for (const row of pending ?? []) {
    pendingScanned++
    const body = (row.content as string | null) ?? ''
    if (!body) continue
    const fresh = parseFhIntegrationEmail(body)
    const md = (row.metadata ?? {}) as Record<string, unknown>
    const prev = (md.fh_parsed as Record<string, unknown> | undefined) ?? {}
    if (prev.country === fresh.country
        && prev.name === fresh.name
        && prev.shortname === fresh.shortname
        && prev.email === fresh.email
        && prev.invoicingSystem === fresh.invoicingSystem
        && prev.authorization === fresh.authorization) continue

    const merged = { ...md, fh_parsed: fresh }
    const { error: upErr } = await supabase
      .from('interactions')
      .update({ metadata: merged })
      .eq('id', row.id)
    if (!upErr) pendingUpdated++
  }

  // 2. Already-converted fh_integrations rows — re-derive country from source email
  const { data: integrations, error: intErr } = await supabase
    .from('fh_integrations')
    .select('id, country, source_interaction_id')
    .limit(2000)

  if (intErr) return NextResponse.json({ ok: false, error: intErr.message }, { status: 500 })

  let integrationsScanned = 0
  let integrationsUpdated = 0
  for (const fh of integrations ?? []) {
    integrationsScanned++
    if (!fh.source_interaction_id) continue
    // Only touch rows that look misclassified ('other' or null) — leave manual edits alone
    if (fh.country && fh.country !== 'other') continue

    const { data: src } = await supabase
      .from('interactions')
      .select('content')
      .eq('id', fh.source_interaction_id)
      .maybeSingle()

    const body = (src?.content as string | null) ?? ''
    if (!body) continue

    const parsed = parseFhIntegrationEmail(body)
    const next = parsed.country ?? normalizeFhCountry(null)
    if (!next) continue
    if (next === fh.country) continue

    const { error: upErr } = await supabase
      .from('fh_integrations')
      .update({ country: next })
      .eq('id', fh.id)
    if (!upErr) integrationsUpdated++
  }

  return NextResponse.json({
    ok: true,
    pending_scanned: pendingScanned,
    pending_updated: pendingUpdated,
    integrations_scanned: integrationsScanned,
    integrations_updated: integrationsUpdated,
  })
}
