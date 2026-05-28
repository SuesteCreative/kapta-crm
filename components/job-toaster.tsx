'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

type JobRow = {
  id: string
  kind: string
  status: 'running' | 'done' | 'failed'
  message: string | null
  metadata: Record<string, unknown> | null
  started_at: string
  completed_at: string | null
}

// Subscribes to job_status changes and surfaces a sonner toast whenever a
// background job (Inngest function) reaches a terminal state.
// Mounted once at the root layout level so toasts appear regardless of
// which route the user is on.
export function JobToaster() {
  const router = useRouter()

  useEffect(() => {
    const channel = supabase
      .channel('job_status_watch')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'job_status' },
        (payload) => {
          const row = payload.new as JobRow
          if (row.status === 'running') return

          const label = labelFor(row.kind)
          if (row.status === 'done') {
            toast.success(`${label} concluído`, {
              description: row.message ?? undefined,
              duration: 6000,
            })
            // Refresh server components so new email rows / counts show up.
            if (row.kind === 'imap_sync') router.refresh()
          } else if (row.status === 'failed') {
            toast.error(`${label} falhou`, {
              description: row.message ?? undefined,
              duration: Infinity,
            })
          }
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [router])

  return null
}

function labelFor(kind: string): string {
  switch (kind) {
    case 'imap_sync': return 'Sync email'
    default: return kind
  }
}
