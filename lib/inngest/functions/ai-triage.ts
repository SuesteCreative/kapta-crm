import { inngest } from '@/lib/inngest/client'
import { createServiceClient } from '@/lib/supabase'
import { runTriageInbox } from '@/lib/ai/triage-core'

/**
 * Background inbox triage. Pedro clicks "Analisar com IA" in /follow-ups
 * and we used to block the UI for 15-30s while Sonnet processed 15 emails.
 * Now the click only dispatches an event; this Inngest function picks it up,
 * persists the results to interactions.metadata.ai_triage as before, and
 * notifies the UI via job_status realtime.
 */
export const aiTriage = inngest.createFunction(
  {
    id: 'ai-triage',
    name: 'AI inbox triage',
    triggers: [{ event: 'ai/triage.requested' }],
    concurrency: { limit: 1 },
    debounce: { period: '60s', key: 'event.data.trigger' },
  },
  async ({ event, step, logger }) => {
    const trigger = event.data.trigger as 'manual' | 'cron'
    const supabase = createServiceClient()

    const jobId = await step.run('ensure-job-row', async () => {
      const { data, error } = await supabase
        .from('job_status')
        .insert({
          kind: 'ai_triage',
          status: 'running',
          message: 'A analisar emails…',
          metadata: { trigger },
        })
        .select('id')
        .single()
      if (error) throw new Error(`job_status insert failed: ${error.message}`)
      return data.id as string
    })

    const result = await step.run('run-triage', () => runTriageInbox())

    if (!result.ok) {
      logger.error('ai-triage failed', { err: result.error })
      await supabase
        .from('job_status')
        .update({
          status: 'failed',
          message: result.error.slice(0, 500),
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId)
      throw new Error(result.error)
    }

    await supabase
      .from('job_status')
      .update({
        status: 'done',
        message: result.results.length > 0
          ? `${result.results.length} email${result.results.length === 1 ? '' : 's'} analisados (de ${result.total} por responder)`
          : (result.message ?? 'Nenhum email a triar'),
        metadata: { trigger, analyzed: result.results.length, total: result.total },
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    return { jobId, analyzed: result.results.length, total: result.total }
  },
)
