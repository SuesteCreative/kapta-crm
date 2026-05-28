import { inngest } from '@/lib/inngest/client'
import { createServiceClient } from '@/lib/supabase'
import { runImapSync, countPendingCandidates } from '@/lib/imap/sync-core'

// Number of emails to fully process per Inngest invocation. Kept low so each
// invocation finishes under Vercel Hobby's 60s function limit; the function
// chains itself via continuation events until the backlog is cleared.
const CHUNK_SIZE = 25

/**
 * Manual + cron-triggered IMAP sync.
 *
 * On first invocation (no incoming jobId): counts pending candidates so the
 * UI progress bar has a denominator, then processes the first chunk. Each
 * subsequent invocation re-uses the same job_status row and increments the
 * synced count.
 */
export const imapSync = inngest.createFunction(
  {
    id: 'imap-sync',
    name: 'IMAP sync',
    triggers: [{ event: 'imap/sync.requested' }],
    concurrency: { limit: 1 },
  },
  async ({ event, step, logger }) => {
    const trigger = event.data.trigger as 'cron' | 'manual' | 'continue'
    const incomingJobId = event.data.jobId as string | undefined
    const supabase = createServiceClient()

    // Reuse an existing job_status row across the continuation chain.
    // On the first invocation (no incoming jobId), pre-count pending
    // candidates so the UI progress bar can render percentage.
    const { jobId, total } = await step.run('ensure-job-row', async () => {
      if (incomingJobId) {
        const { data } = await supabase
          .from('job_status')
          .select('metadata')
          .eq('id', incomingJobId)
          .maybeSingle()
        const meta = (data?.metadata as Record<string, unknown> | null) ?? {}
        return { jobId: incomingJobId, total: (meta.total as number) ?? 0 }
      }

      const counted = await countPendingCandidates()
      const { data, error } = await supabase
        .from('job_status')
        .insert({
          kind: 'imap_sync',
          status: 'running',
          message: counted.total > 0 ? `0 / ${counted.total}` : 'Sem novos emails',
          metadata: {
            trigger,
            total: counted.total,
            chunks: 0,
            synced: 0,
            created: 0,
            skipped: 0,
            phase: counted.total > 0 ? 'syncing' : 'idle',
          },
        })
        .select('id')
        .single()
      if (error) throw new Error(`job_status insert failed: ${error.message}`)
      return { jobId: data.id as string, total: counted.total }
    })

    // No new emails — short-circuit so the user gets immediate feedback.
    if (total === 0 && !incomingJobId) {
      await step.run('mark-empty-done', async () => {
        await supabase
          .from('job_status')
          .update({
            status: 'done',
            message: 'Sem novos emails',
            completed_at: new Date().toISOString(),
          })
          .eq('id', jobId)
      })
      return { jobId, hasMore: false, totals: { total: 0, synced: 0, created: 0, skipped: 0 } }
    }

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

    const totals = await step.run('accumulate-counts', async () => {
      const { data: existing } = await supabase
        .from('job_status')
        .select('metadata')
        .eq('id', jobId)
        .maybeSingle()
      const prev = (existing?.metadata as Record<string, number | string> | null) ?? {}
      const prevSynced = (prev.synced as number) ?? 0
      const prevCreated = (prev.created as number) ?? 0
      const prevSkipped = (prev.skipped as number) ?? 0
      const prevChunks = (prev.chunks as number) ?? 0
      const totalCount = (prev.total as number) ?? total
      return {
        trigger,
        total: totalCount,
        chunks:  prevChunks + 1,
        synced:  prevSynced + result.synced,
        created: prevCreated + result.created_leads,
        skipped: prevSkipped + result.skipped_duplicate,
      }
    })

    if (result.hasMore) {
      await step.run('persist-running', async () => {
        await supabase
          .from('job_status')
          .update({
            status: 'running',
            message: `${totals.synced} / ${totals.total}`,
            metadata: { ...totals, phase: 'syncing' },
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
      const synced = totals.synced
      const created = totals.created
      const msg = synced > 0
        ? `${synced} email${synced === 1 ? '' : 's'} importados${created > 0 ? `, ${created} lead${created === 1 ? '' : 's'} novo${created === 1 ? '' : 's'}` : ''}`
        : 'Sem novos emails'
      await supabase
        .from('job_status')
        .update({
          status: 'done',
          message: msg,
          metadata: { ...totals, phase: 'done' },
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId)
    })

    return { jobId, hasMore: false, totals }
  },
)
