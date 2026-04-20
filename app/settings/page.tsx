export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
import { SettingsClient } from '@/components/settings-client'

export default async function SettingsPage() {
  const supabase = createServiceClient()
  const [{ data: sig }, { data: mem }] = await Promise.all([
    supabase.from('templates').select('body').eq('name', '__signature__').maybeSingle(),
    supabase.from('templates').select('body').eq('name', '__ai_memory__').maybeSingle(),
  ])

  return <SettingsClient initialSignature={sig?.body ?? ''} initialMemory={mem?.body ?? ''} />
}
