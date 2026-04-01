import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Untyped client — we use our own types from database.types.ts at the component level.
// Once you have a real Supabase project, run `supabase gen types` to replace this.

let _client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    _client = createClient(url, anon)
  }
  return _client
}

// Named export used across the app — lazily initialised
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabase() as unknown as Record<string | symbol, unknown>)[prop]
  },
})

// Server-side client with service role (for API routes / IMAP sync)
export function createServiceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}
