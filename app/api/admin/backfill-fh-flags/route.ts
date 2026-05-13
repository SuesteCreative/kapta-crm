import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/api-auth'
import {
  parseFhIntegrationEmail, parseFhConfirmationEmail,
} from '@/lib/fh-integration-parser'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * One-shot backfill: re-flag historical FH form-submission emails and
 * Kapta confirmation emails that pre-date the current classifier logic.
 *
 * Scans interactions matching either:
 *  - "New integration has been submitted via the FareHarbor" template
 *  - "A sua integração com a Kapta está concluída" template
 *
 * Writes metadata.fh_integration_request=true + fh_parsed for unflagged rows
 * (only when fh_integration_id is not yet set — never touches converted rows).
 * For confirmation emails: also attempts to bump matching fh_integration to
 * integration_done if a partner is found by email.
 *
 * POST → { ok, form_flagged, confirm_flagged, confirm_bumped, scanned }
 */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  const supabase = createServiceClient()

  type Identifier = { type: string; value: string; is_primary: boolean }
  type CustomerWithIds = { id: string; customer_identifiers?: Identifier[] }

  const { data: rows, error } = await supabase
    .from('interactions')
    .select('id, occurred_at, content, metadata, customer_id, customers(id, customer_identifiers(type, value, is_primary))')
    .or('content.ilike.%new integration has been submitted via the fareharbor%,content.ilike.%a sua integra%kapta%conclu%')
    .order('occurred_at', { ascending: false })
    .limit(2000)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  let formFlagged = 0
  let confirmFlagged = 0
  let confirmBumped = 0
  const scanned = (rows ?? []).length

  for (const r of rows ?? []) {
    const md = (r.metadata ?? {}) as Record<string, unknown>
    if (md.fh_integration_id) continue   // already converted — leave alone

    const body = (r.content as string | null) ?? ''
    if (!body) continue

    // Determine partner email from the customer link (the partner customer was
    // already linked at sync time, even if flag wasn't set).
    const cust = r.customers as CustomerWithIds | CustomerWithIds[] | null | undefined
    const c = Array.isArray(cust) ? cust[0] : cust
    const ids = c?.customer_identifiers?.filter((i) => i.type === 'email') ?? []
    const primary = ids.find((i) => i.is_primary) ?? ids[0]
    const partnerEmail = (primary?.value ?? '').toLowerCase().trim()

    // Case 1: FH form submission template
    if (/new integration has been submitted via the FareHarbor/i.test(body)) {
      if (md.fh_integration_request === true) continue   // already flagged
      const fhP = parseFhIntegrationEmail(body)
      const newMd = {
        ...md,
        fh_integration_request: true,
        fh_parsed: fhP,
      }
      const { error: upErr } = await supabase
        .from('interactions')
        .update({ metadata: newMd })
        .eq('id', r.id)
      if (!upErr) formFlagged++
      continue
    }

    // Case 2: Kapta confirmation template ("integração com a Kapta está concluída")
    if (/a sua integra[çc][ãa]o com a kapta est[áa] conclu[íi]da/i.test(body)) {
      const confP = parseFhConfirmationEmail(body, partnerEmail || null)

      // Try to bump matching fh_integration
      let bumpedId: string | null = null
      if (partnerEmail) {
        const { data: existingFh } = await supabase
          .from('fh_integrations')
          .select('id, status, integration_completed_at')
          .eq('email', partnerEmail)
          .maybeSingle()
        if (existingFh) {
          bumpedId = existingFh.id
          const nextStatus = existingFh.status === 'live' ? 'live' : 'integration_done'
          await supabase
            .from('fh_integrations')
            .update({
              status: nextStatus,
              integration_completed_at: existingFh.integration_completed_at ?? r.occurred_at,
            })
            .eq('id', existingFh.id)
          confirmBumped++
        }
      }

      // Write metadata: if no integration to bump, flag as pending
      const nextMd: Record<string, unknown> = { ...md }
      if (bumpedId) {
        nextMd.fh_confirmation_bumped = bumpedId
      } else if (md.fh_integration_request !== true) {
        nextMd.fh_integration_request = true
        nextMd.fh_confirmation = true
        nextMd.fh_parsed = { email: partnerEmail || null, name: confP.name ?? null }
        confirmFlagged++
      } else {
        continue   // already flagged, no bump needed
      }

      const { error: upErr } = await supabase
        .from('interactions')
        .update({ metadata: nextMd })
        .eq('id', r.id)
      if (upErr && !bumpedId) confirmFlagged--   // rollback counter on failure
    }
  }

  return NextResponse.json({
    ok: true,
    scanned,
    form_flagged: formFlagged,
    confirm_flagged: confirmFlagged,
    confirm_bumped: confirmBumped,
  })
}
