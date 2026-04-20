export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
import { TemplatesClient } from '@/components/templates-client'

export default async function TemplatesPage() {
  const supabase = createServiceClient()
  const { data } = await supabase.from('templates').select('*').order('name')
  return <TemplatesClient templates={data ?? []} />
}
