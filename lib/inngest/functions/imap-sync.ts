import { NonRetriableError } from 'inngest'
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
    // A failed sync is superseded by the next auto-sync ≤15 min later, so one
    // retry is plenty. timeouts.start expires runs that sit queued behind the
    // concurrency:1 slot instead of letting an outage build a FIFO backlog
    // that starves every later manual sync (the 2026-06-11..12 incident).
    retries: 1,
    timeouts: { start: '10m' },
    // Last-resort truth: if the run dies in any way that skips mark-failed
    // (throw inside ensure-job-row, lost continuation, retries exhausted),
    // stamp the job row failed so the UI never shows a forever-spinner.
    onFailure: async ({ event, error }) => {
      const supabase = createServiceClient()
      const original = event.data.event as { data?: { jobId?: string } } | undefined
      const jobId = original?.data?.jobId
      const update = {
        status: 'failed',
        message: `Sync falhou: ${error.message}`.slice(0, 500),
        completed_at: new Date().toISOString(),
      }
      if (jobId) {
        await supabase.from('job_status').update(update).eq('id', jobId)
      } else {
        await supabase
          .from('job_status')
          .update(update)
          .eq('kind', 'imap_sync')
          .eq('status', 'running')
      }
    },
  },
  async ({ event, step, logger }) => {
    const trigger = event.data.trigger as 'cron' | 'manual' | 'continue'
    const incomingJobId = event.data.jobId as string | undefined
    const supabase = createServiceClient()

    // Reuse an existing job_status row across the continuation chain.
    // On the first invocation (no incoming jobId), pre-count pending
    // candidates so the UI progress bar can render percentage.
    const { jobId, total, countError } = await step.run('ensure-job-row', async () => {
      if (incomingJobId) {
        const { data } = await supabase
          .from('job_status')
          .select('metadata')
          .eq('id', incomingJobId)
          .maybeSingle()
        const meta = (data?.metadata as Record<string, unknown> | null) ?? {}
        return { jobId: incomingJobId, total: (meta.total as number) ?? 0, countError: null as string | null }
      }

      // Sweep rows stranded in 'running' by a dead continuation chain. Done
      // here (not a cron) so it runs exactly when a stale row could confuse
      // the dispatch backpressure check or pin a forever-spinner in the UI.
      await supabase
        .from('job_status')
        .update({
          status: 'failed',
          message: 'Expirado: sync anterior nunca terminou',
          completed_at: new Date().toISOString(),
        })
        .eq('kind', 'imap_sync')
        .eq('status', 'running')
        .lt('started_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())

      const counted = await countPendingCandidates()
      const { data, error } = await supabase
        .from('job_status')
        .insert({
          kind: 'imap_sync',
          status: 'running',
          message: counted.error
            ? `IMAP: ${counted.error}`.slice(0, 500)
            : counted.total > 0 ? `0 / ${counted.total}` : 'Sem novos emails',
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
      return { jobId: data.id as string, total: counted.total, countError: counted.error ?? null }
    })

    // A failed candidate count used to masquerade as "Sem novos emails" (the
    // .error field was never read) — an IMAP outage or IP ban looked exactly
    // like a quiet inbox. Fail loudly instead; the JobToaster shows the row.
    if (countError) {
      await step.run('mark-count-failed', async () => {
        await supabase
          .from('job_status')
          .update({
            status: 'failed',
            message: `IMAP: ${countError}`.slice(0, 500),
            completed_at: new Date().toISOString(),
          })
          .eq('id', jobId)
      })
      throw new NonRetriableError(`countPendingCandidates failed: ${countError}`)
    }

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
        // An empty inbox is still a healthy sync — keep the dead-man switch fed.
        if (process.env.HEALTHCHECK_SYNC_URL) {
          await fetch(process.env.HEALTHCHECK_SYNC_URL).catch(() => {})
        }
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

      // Dead-man switch: healthchecks.io alerts Pedro if no successful sync
      // pings within the configured period+grace. Pinged only on a genuinely
      // completed run, so every silent-failure mode trips the alarm. No-op
      // until HEALTHCHECK_SYNC_URL is set in Vercel.
      if (process.env.HEALTHCHECK_SYNC_URL) {
        await fetch(process.env.HEALTHCHECK_SYNC_URL).catch(() => {})
      }
    })

    return { jobId, hasMore: false, totals }
  },
)
