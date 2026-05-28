import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest/client'
import { imapSync } from '@/lib/inngest/functions/imap-sync'

// Inngest serves all registered functions through this single endpoint.
// The Vercel ↔ Inngest integration auto-syncs the function list on every
// deploy by hitting this URL with the signing key.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [imapSync],
})
