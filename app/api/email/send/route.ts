import { NextResponse } from 'next/server'
import { sendEmailCore, type AttachmentInput } from '@/lib/send-email-core'
import { createServiceClient } from '@/lib/supabase'
import { hasCommitmentLanguage, detectCommitment, resolveDueDate } from '@/lib/commitment-detect'
import { sendCalendarInvite } from '@/lib/send-calendar-invite'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface RequestBody {
  customer_id?: string | null
  to: string | string[]
  cc?: string | string[]
  bcc?: string | string[]
  subject: string
  body: string
  attachments?: AttachmentInput[]
}

function asArray(v: string | string[] | undefined | null): string[] {
  if (!v) return []
  if (Array.isArray(v)) return v.map((s) => s.trim()).filter(Boolean)
  return v.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
}

interface AutoFollowUp {
  id: string
  title: string
  due_date: string
}

/**
 * If the just-sent email promises to get back to the client, auto-create a
 * follow-up (topic + due date) and fire a calendar invite. Best-effort:
 * never throws, returns null when nothing was created.
 */
async function maybeCreateFollowUp(
  customerId: string,
  interactionId: string | null,
  subject: string,
  body: string,
): Promise<AutoFollowUp | null> {
  try {
    if (!hasCommitmentLanguage(`${subject}\n${body}`)) return null

    const supabase = createServiceClient()

    // Dedup: skip if an auto follow-up for this customer was created in the last 24h.
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data: recent } = await supabase
      .from('follow_ups')
      .select('id')
      .eq('customer_id', customerId)
      .eq('status', 'open')
      .eq('auto_created', true)
      .gte('created_at', dayAgo)
      .limit(1)
    if (recent && recent.length > 0) return null

    const detection = await detectCommitment(subject, body)
    if (!detection.isCommitment) return null

    const dueDate = resolveDueDate(detection.dueDateISO)
    const topic = detection.topic || subject.replace(/^(re|fwd?):\s*/i, '').trim() || 'seguimento'
    const title = topic.length > 90 ? `${topic.slice(0, 87)}…` : topic

    const { data: created, error } = await supabase
      .from('follow_ups')
      .insert({
        customer_id: customerId,
        title,
        description: `Prometeste voltar a contactar sobre isto no email "${subject}".`,
        due_date: dueDate,
        priority: 'medium',
        auto_created: true,
        source_interaction_id: interactionId,
      })
      .select('id, title, due_date')
      .single()

    if (error || !created) {
      console.error('auto follow-up insert failed:', error?.message)
      return null
    }

    // Fetch client details so the calendar reminder says who to contact.
    const { data: cust } = await supabase
      .from('customers')
      .select('name, company, customer_identifiers ( type, value, is_primary )')
      .eq('id', customerId)
      .single()
    const idents = (cust?.customer_identifiers ?? []) as Array<{ type: string; value: string; is_primary: boolean }>
    const emails = idents.filter((i) => i.type === 'email')
    const primaryEmail = emails.find((e) => e.is_primary)?.value ?? emails[0]?.value ?? null

    // "Os dois": also drop a calendar invite in Pedro's Google Calendar.
    await sendCalendarInvite({
      title,
      dueDateISO: dueDate,
      followUpId: created.id,
      customerName: cust?.name ?? null,
      customerCompany: cust?.company ?? null,
      customerEmail: primaryEmail,
    })

    return { id: created.id, title: created.title, due_date: created.due_date }
  } catch (err) {
    console.error('maybeCreateFollowUp error:', err instanceof Error ? err.message : String(err))
    return null
  }
}

export async function POST(request: Request) {
  let data: RequestBody
  try {
    data = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const { messageId, interactionId } = await sendEmailCore({
      customer_id: data.customer_id ?? null,
      to:  asArray(data.to),
      cc:  asArray(data.cc),
      bcc: asArray(data.bcc),
      subject: data.subject,
      body: data.body,
      attachments: data.attachments ?? [],
    })

    // Auto-create a follow-up reminder when Pedro promised to get back to the client.
    const followUp = data.customer_id
      ? await maybeCreateFollowUp(data.customer_id, interactionId, data.subject, data.body)
      : null

    return NextResponse.json({ ok: true, messageId, followUp })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('SMTP send error:', msg)
    const status = msg.includes('required') || msg.includes('exceeds') ? 400 : 500
    return NextResponse.json({ ok: false, error: msg }, { status })
  }
}
