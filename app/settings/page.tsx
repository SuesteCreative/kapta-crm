export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
import { SettingsClient } from '@/components/settings-client'

export default async function SettingsPage() {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('templates')
    .select('body')
    .eq('name', '__signature__')
    .maybeSingle()

  return <SettingsClient initialSignature={data?.body ?? ''} />
}
