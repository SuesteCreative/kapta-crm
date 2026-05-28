import { inngest } from '@/lib/inngest/client'
import { createServiceClient } from '@/lib/supabase'

const SYNC_TIMEOUT_MS = 4 * 60 * 1000

// Resolves the deployed URL so the Inngest function (running on its own
// invocation) can call the existing /api/imap/sync route. Falls back to
// localhost in dev.
function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

/**
 * Manual + cron-triggered IMAP sync.
 * The Inngest layer gives us:
 *  - non-blocking UX (sidebar dispatches an event, returns immediately)
 *  - retries on transient failures (the underlying sync is dedup-safe)
 *  - a job_status row the UI subscribes to for completion toasts
 */
export const imapSync = inngest.createFunction(
  {
    id: 'imap-sync',
    name: 'IMAP sync',
    triggers: [{ event: 'imap/sync.requested' }],
    // Concurrency 1 — never run two syncs in parallel (would race on inserts).
    concurrency: { limit: 1 },
    // Dedupe rapid-fire dispatches (e.g. sidebar double-click): collapse
    // events with the same trigger into one within a 60s window.
    debounce: { period: '60s', key: 'event.data.trigger' },
  },
  async ({ event, step, logger }) => {
    const trigger = event.data.trigger
    const supabase = createServiceClient()

    const jobRow = await step.run('create-job-row', async () => {
      const { data, error } = await supabase
        .from('job_status')
        .insert({ kind: 'imap_sync', status: 'running', metadata: { trigger } })
        .select('id')
        .single()
      if (error) throw new Error(`job_status insert failed: ${error.message}`)
      return data
    })

    try {
      const result = await step.run('call-imap-sync', async () => {
        const url = `${getBaseUrl()}/api/imap/sync`
        const res = await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
          signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
        })
        const text = await res.text()
        let json: Record<string, unknown> = {}
        try { json = JSON.parse(text) } catch { /* keep empty */ }
        if (!res.ok || json.ok === false) {
          throw new Error((json.error as string) ?? `sync route HTTP ${res.status}: ${text.slice(0, 300)}`)
        }
        return json
      })

      await step.run('mark-done', async () => {
        const synced = (result.synced as number) ?? 0
        const created = (result.created_leads as number) ?? 0
        const skipped = (result.skipped_duplicate as number) ?? 0
        const msg = synced > 0
          ? `${synced} email${synced === 1 ? '' : 's'} importados${created > 0 ? `, ${created} lead${created === 1 ? '' : 's'} novo${created === 1 ? '' : 's'}` : ''}`
          : 'Sem novos emails'
        await supabase
          .from('job_status')
          .update({
            status: 'done',
            message: msg,
            metadata: { trigger, synced, created, skipped },
            completed_at: new Date().toISOString(),
          })
          .eq('id', jobRow.id)
      })

      return { jobId: jobRow.id, ...result }
    } catch (err) {
      logger.error('imap-sync failed', { err })
      const msg = err instanceof Error ? err.message : String(err)
      await supabase
        .from('job_status')
        .update({
          status: 'failed',
          message: msg.slice(0, 500),
          metadata: { trigger, error: msg },
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobRow.id)
      throw err
    }
  },
)
