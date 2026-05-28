import { Inngest } from 'inngest'

// Single Inngest client for the whole app.
// Env keys (INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY) are injected by the
// Vercel ↔ Inngest integration. Local dev works without them: the SDK
// auto-detects the dev server on localhost:8288.
export const inngest = new Inngest({
  id: 'kapta-crm',
})

// Event schemas — keep narrow + typed for safer dispatch sites.
export type Events = {
  'imap/sync.requested': { data: { trigger: 'cron' | 'manual'; requestedBy?: string } }
  'imap/sync-customer.requested': { data: { emails: string[]; requestedBy?: string } }
}
