import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { inngest } from '@/lib/inngest/client'

export const dynamic = 'force-dynamic'

/**
 * Fire-and-forget AI triage. Pedro clicks "Analisar com IA" in follow-ups;
 * we dispatch an Inngest event and return immediately. The function writes
 * the results to interactions.metadata.ai_triage and the UI picks them up
 * when the follow-ups query is invalidated on job_status.done.
 */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  await inngest.send({
    name: 'ai/triage.requested',
    data: { trigger: 'manual' },
  })

  return NextResponse.json({ ok: true, dispatched: true })
}
