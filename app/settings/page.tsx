export const dynamic = 'force-dynamic'

import { supabase } from '@/lib/supabase'
import { SettingsClient } from '@/components/settings-client'

export default async function SettingsPage() {
  const { data } = await supabase
    .from('templates')
    .select('body')
    .eq('type', 'signature')
    .eq('name', '__signature__')
    .maybeSingle()

  return <SettingsClient initialSignature={data?.body ?? ''} />
}
