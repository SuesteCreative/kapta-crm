import { inngest } from '@/lib/inngest/client'
import { createServiceClient } from '@/lib/supabase'
import { runImapSync } from '@/lib/imap/sync-core'

// Number of emails to fully process per Inngest invocation. Kept low so each
// invocation finishes under Vercel Hobby's 60s function limit; the function
// chains itself via continuation events until the backlog is cleared.
const CHUNK_SIZE = 25

/**
 * Manual + cron-triggered IMAP sync.
 *
 * Each invocation processes up to CHUNK_SIZE candidate emails. If more
 * candidates remain (hasMore=true), the function dispatches another
 * `imap/sync.requested` event with trigger='continue' and the same jobId,
 * so the job_status row tracks the whole chain to completion.
 */
export const imapSync = inngest.createFunction(
  {
    id: 'imap-sync',
    name: 'IMAP sync',
    triggers: [{ event: 'imap/sync.requested' }],
    concurrency: { limit: 1 },
    // Debounce only manual triggers — continuation events must always fire.
    debounce: { period: '60s', key: 'event.data.trigger === "manual" ? "manual" : event.id' },
  },
  async ({ event, step, logger }) => {
    const trigger = event.data.trigger as 'cron' | 'manual' | 'continue'
    const incomingJobId = event.data.jobId as string | undefined
    const supabase = createServiceClient()

    // Reuse an existing job_status row across the continuation chain so the
    // user sees one "Sync email" task, not one per chunk.
    const jobId = await step.run('ensure-job-row', async () => {
      if (incomingJobId) return incomingJobId
      const { data, error } = await supabase
        .from('job_status')
        .insert({ kind: 'imap_sync', status: 'running', metadata: { trigger, chunks: 0, synced: 0, created: 0, skipped: 0 } })
        .select('id')
        .single()
      if (error) throw new Error(`job_status insert failed: ${error.message}`)
      return data.id as string
    })

    const result = await step.run('sync-chunk', () => runImapSync({ maxEmails: CHUNK_SIZE }))

    if (!result.ok) {
      await step.run('mark-failed', async () => {
        await supabase
          .from('job_status')
          .update({
            status: 'failed',
            message: result.error.slice(0, 500),
            completed_at: new Date().toISOString(),
          })
          .eq('id', jobId)
      })
      throw new Error(result.error)
    }

    // Accumulate counts in job_status.metadata so the final toast can show
    // the total across all chunks.
    const totals = await step.run('accumulate-counts', async () => {
      const { data: existing } = await supabase
        .from('job_status')
        .select('metadata')
        .eq('id', jobId)
        .maybeSingle()
      const prev = (existing?.metadata as Record<string, number> | null) ?? {}
      const next = {
        ...prev,
        trigger,
        chunks:  (prev.chunks  ?? 0) + 1,
        synced:  (prev.synced  ?? 0) + result.synced,
        created: (prev.created ?? 0) + result.created_leads,
        skipped: (prev.skipped ?? 0) + result.skipped_duplicate,
      }
      return next
    })

    if (result.hasMore) {
      await step.run('persist-running', async () => {
        await supabase
          .from('job_status')
          .update({
            status: 'running',
            message: `${totals.synced} importados (continuando…)`,
            metadata: totals,
          })
          .eq('id', jobId)
      })
      await step.sendEvent('continue-sync', {
        name: 'imap/sync.requested',
        data: { trigger: 'continue', jobId },
      })
      logger.info('imap-sync chunk done, continuing', { chunks: totals.chunks, syncedSoFar: totals.synced })
      return { jobId, hasMore: true, totals }
    }

    await step.run('mark-done', async () => {
      const synced = totals.synced as number
      const created = totals.created as number
      const msg = synced > 0
        ? `${synced} email${synced === 1 ? '' : 's'} importados${created > 0 ? `, ${created} lead${created === 1 ? '' : 's'} novo${created === 1 ? '' : 's'}` : ''}`
        : 'Sem novos emails'
      await supabase
        .from('job_status')
        .update({
          status: 'done',
          message: msg,
          metadata: totals,
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId)
    })

    return { jobId, hasMore: false, totals }
  },
)
