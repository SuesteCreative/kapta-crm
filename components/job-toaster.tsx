'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useQueryClient } from '@tanstack/react-query'

type JobRow = {
  id: string
  kind: string
  status: 'running' | 'done' | 'failed'
  message: string | null
  metadata: Record<string, unknown> | null
  started_at: string
  completed_at: string | null
}

// Subscribes to job_status changes and renders a persistent sonner toast
// with a progress bar for in-flight syncs. The same toast id is reused on
// every update so the bar animates smoothly across the multi-chunk chain.
export function JobToaster() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const activeToastIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    function showProgress(row: JobRow) {
      const total = (row.metadata?.total as number) ?? 0
      const synced = (row.metadata?.synced as number) ?? 0
      const pct = total > 0 ? Math.min(100, Math.round((synced / total) * 100)) : 0

      activeToastIds.current.add(row.id)
      toast.custom(
        () => (
          <div
            className="rounded-lg shadow-lg p-4 min-w-[300px]"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--primary)' }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{labelFor(row.kind)}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted-foreground)', tabularNums: true } as React.CSSProperties}>
                {total > 0 ? `${synced} / ${total}` : '…'}
              </span>
            </div>
            <div
              style={{
                height: 4,
                background: 'var(--muted, #e5e7eb)',
                borderRadius: 999,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: 'var(--primary)',
                  transition: 'width 300ms ease-out',
                  borderRadius: 999,
                }}
              />
            </div>
            {total === 0 && (
              <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 6 }}>
                A contar emails pendentes…
              </div>
            )}
          </div>
        ),
        { id: `job-${row.id}`, duration: Infinity },
      )
    }

    function dismissProgress(jobId: string) {
      toast.dismiss(`job-${jobId}`)
      activeToastIds.current.delete(jobId)
    }

    function showDone(row: JobRow) {
      const wasRunning = activeToastIds.current.has(row.id)
      dismissProgress(row.id)
      // Skip the success toast for empty (no new emails) on the very first
      // tick — it would feel noisy. Show only when something actually synced
      // or this was an active sync the user was watching.
      const synced = (row.metadata?.synced as number) ?? 0
      if (!wasRunning && synced === 0) return

      toast.custom(
        () => (
          <div
            className="rounded-lg shadow-lg p-4 min-w-[280px]"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle2 className="h-4 w-4" style={{ color: '#22c55e' }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{labelFor(row.kind)} concluído</span>
            </div>
            {row.message && (
              <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 4 }}>
                {row.message}
              </div>
            )}
          </div>
        ),
        { duration: 6000 },
      )
      if (row.kind === 'imap_sync') {
        // Invalidate any client-cached query that depends on the emails
        // table so the UI picks up the new rows without a full page
        // reload, and fall back to router.refresh() for server components
        // still on the old data-fetch path.
        queryClient.invalidateQueries({ queryKey: ['emails', 'list'] })
        queryClient.invalidateQueries({ queryKey: ['follow-ups', 'inbound'] })
        router.refresh()
      } else if (row.kind === 'ai_triage') {
        // Triage wrote ai_triage metadata onto inbound interactions; the
        // /follow-ups "Por responder" list reads it for the priority pills.
        queryClient.invalidateQueries({ queryKey: ['follow-ups', 'inbound'] })
      }
    }

    function showFailed(row: JobRow) {
      dismissProgress(row.id)
      toast.custom(
        () => (
          <div
            className="rounded-lg shadow-lg p-4 min-w-[280px]"
            style={{
              background: 'var(--card)',
              border: '1px solid #ef4444',
              color: 'var(--foreground)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle className="h-4 w-4" style={{ color: '#ef4444' }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{labelFor(row.kind)} falhou</span>
            </div>
            {row.message && (
              <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 4 }}>
                {row.message}
              </div>
            )}
          </div>
        ),
        { duration: Infinity },
      )
    }

    const channel = supabase
      .channel('job_status_watch')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'job_status' },
        (payload) => {
          const row = payload.new as JobRow
          if (row.kind !== 'imap_sync') return
          if (row.status === 'running') showProgress(row)
          else if (row.status === 'done') showDone(row)
          else if (row.status === 'failed') showFailed(row)
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'job_status' },
        (payload) => {
          const row = payload.new as JobRow
          if (row.kind !== 'imap_sync') return
          if (row.status === 'running') showProgress(row)
          else if (row.status === 'done') showDone(row)
          else if (row.status === 'failed') showFailed(row)
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [router, queryClient])

  return null
}

function labelFor(kind: string): string {
  switch (kind) {
    case 'imap_sync': return 'Sync email'
    case 'ai_triage': return 'Análise IA'
    default: return kind
  }
}
