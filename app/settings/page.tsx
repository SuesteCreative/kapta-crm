export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
import { SettingsClient } from '@/components/settings-client'

export default async function SettingsPage() {
  const supabase = createServiceClient()
  const [{ data: sig }, { data: mem }, { data: cal }] = await Promise.all([
    supabase.from('templates').select('body').eq('name', '__signature__').maybeSingle(),
    supabase.from('templates').select('body').eq('name', '__ai_memory__').maybeSingle(),
    supabase.from('templates').select('body').eq('name', '__calendly_url__').maybeSingle(),
  ])

  return (
    <SettingsClient
      initialSignature={sig?.body ?? ''}
      initialMemory={mem?.body ?? ''}
      initialCalendly={cal?.body ?? ''}
    />
  )
}
