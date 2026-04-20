import { NextRequest, NextResponse } from 'next/server'
import { ImapFlow } from 'imapflow'
import { simpleParser, ParsedMail } from 'mailparser'
import { createServiceClient } from '@/lib/supabase'
import { analyzeAttachment } from '@/lib/analyze-attachment'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const ATTACH_BUCKET = 'email-attachments'
const ATTACH_MAX_BYTES   = 15 * 1024 * 1024
const ATTACH_MAX_ANALYZE =  5 * 1024 * 1024

type AttachmentMeta = { name: string; mime: string; size: number; url: string | null; ai_summary: string }

/**
 * Re-fetch already-synced emails from IMAP and re-parse with mailparser.
 * Recovers attachments and re-decodes content for rows stored before the
 * mailparser switch. Preserves existing metadata fields (ai_triage, is_spam…).
 *
 * POST { preview?: boolean, limit?: number }
 */
export async function POST(req: NextRequest) {
  const isVercelCron   = req.headers.get('x-vercel-cron') === '1'
  const sessionCookie  = req.cookies.get('kapta_session')?.value
  const validSession   = process.env.AUTH_SESSION_TOKEN
  const cronSecret     = process.env.CRON_SECRET
  const authHeader     = req.headers.get('authorization')

  const allowed =
    isVercelCron ||
    (validSession && sessionCookie === validSession) ||
    (cronSecret   && authHeader   === `Bearer ${cronSecret}`)

  if (!allowed) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { preview = false, limit = 100 } =
    (await req.json().catch(() => ({}))) as { preview?: boolean; limit?: number }

  const supabase = createServiceClient()

  const { data: rows, error: fetchErr } = await supabase
    .from('interactions')
    .select('id, source_id, metadata, subject')
    .eq('type', 'email')
    .not('source_id', 'is', null)
    .or('metadata->>parsed_version.is.null,metadata->>parsed_version.neq.mailparser-1')
    .order('occurred_at', { ascending: false })
    .limit(limit)

  if (fetchErr) {
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 })
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, reparsed: 0, message: 'Nenhum email precisa de re-processamento.' })
  }

  if (preview) {
    return NextResponse.json({ ok: true, preview: true, pending: rows.length, sample: rows.slice(0, 5).map((r) => r.subject) })
  }

  const client = new ImapFlow({
    host: process.env.IMAP_HOST!,
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: true,
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! },
    tls: { rejectUnauthorized: false },
    logger: false,
  })

  let reparsed = 0
  let notFound = 0
  let attachmentsRestored = 0
  const errors: string[] = []

  try {
    await client.connect()
    await supabase.storage.createBucket(ATTACH_BUCKET, { public: true }).catch(() => null)

    let sentPath = 'Sent'
    try {
      const allBoxes = await client.list()
      const sentBox = allBoxes.find((b) =>
        (b as unknown as Record<string, unknown>).specialUse === '\\Sent' ||
        /^(sent|sent messages|sent items|itens enviados|\[gmail\]\/sent mail|gesendet|éléments envoyés)$/i.test(b.name)
      )
      if (sentBox) sentPath = sentBox.path
    } catch { /* keep default */ }

    const mailboxes = ['INBOX', sentPath]

    for (const row of rows) {
      if (!row.source_id) continue

      let located: { mailbox: string; uid: number } | null = null

      for (const path of mailboxes) {
        let lock
        try { lock = await client.getMailboxLock(path) } catch { continue }
        try {
          const uids = await client.search({ header: { 'message-id': row.source_id } }, { uid: true })
          if (uids && uids.length > 0) {
            located = { mailbox: path, uid: uids[0] }
          }
        } catch { /* search failed */ }
        finally { lock.release() }
        if (located) break
      }

      if (!located) { notFound++; continue }

      let source: Buffer | null = null
      let lock
      try { lock = await client.getMailboxLock(located.mailbox) } catch { notFound++; continue }
      try {
        const msg = await client.fetchOne(located.uid.toString(), { source: true }, { uid: true })
        if (msg && msg.source) source = msg.source as Buffer
      } catch (err) {
        errors.push(`fetch ${row.source_id}: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        lock.release()
      }

      if (!source) { notFound++; continue }

      let parsed: ParsedMail
      try {
        parsed = await simpleParser(source)
      } catch (err) {
        errors.push(`parse ${row.source_id}: ${err instanceof Error ? err.message : String(err)}`)
        continue
      }

      const bodyText = (parsed.text ?? '').trim().slice(0, 4000)
      const bodyHtml = typeof parsed.html === 'string' ? parsed.html.slice(0, 100000) : null

      // Upload attachments
      const attachments: AttachmentMeta[] = []
      for (const att of parsed.attachments ?? []) {
        if (!att.content) continue
        const name = att.filename || `file-${att.cid ?? 'attachment'}`
        const mime = att.contentType ?? 'application/octet-stream'
        const content = att.content as Buffer
        const size = att.size ?? content.length

        if (size > ATTACH_MAX_BYTES) {
          attachments.push({
            name, mime, size, url: null,
            ai_summary: `${name} (${(size / 1024 / 1024).toFixed(1)} MB — too large to download)`,
          })
          continue
        }
        try {
          const ext = name.includes('.') ? name.split('.').pop() : 'bin'
          const fileName = `${row.source_id.replace(/[^a-z0-9]/gi, '_').slice(0, 40)}/${randomUUID()}.${ext}`

          const { error: upErr } = await supabase.storage
            .from(ATTACH_BUCKET)
            .upload(fileName, content, { contentType: mime, upsert: false })
          if (upErr) {
            errors.push(`upload ${name}: ${upErr.message}`)
            continue
          }

          const { data: { publicUrl } } = supabase.storage.from(ATTACH_BUCKET).getPublicUrl(fileName)

          const ai_summary = size <= ATTACH_MAX_ANALYZE
            ? await analyzeAttachment(content, { mime, name, size })
            : name

          attachments.push({ name, mime, size, url: publicUrl, ai_summary })
        } catch (err) {
          errors.push(`upload ${name}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      // Merge metadata — preserve ai_triage, is_spam, etc.
      const existingMeta = (row.metadata as Record<string, unknown> | null) ?? {}
      const mergedMeta: Record<string, unknown> = {
        ...existingMeta,
        parsed_version: 'mailparser-1',
      }
      if (attachments.length > 0) {
        mergedMeta.attachments = attachments
        attachmentsRestored += attachments.length
      }
      if (bodyHtml) {
        mergedMeta.html = bodyHtml
      }

      const { error: updErr } = await supabase
        .from('interactions')
        .update({
          content: bodyText || null,
          subject: parsed.subject ?? undefined,
          metadata: mergedMeta,
        })
        .eq('id', row.id)

      if (updErr) {
        errors.push(`update ${row.source_id}: ${updErr.message}`)
      } else {
        reparsed++
      }
    }

    await client.logout()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg, reparsed, notFound, errors }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    scanned: rows.length,
    reparsed,
    not_found: notFound,
    attachments_restored: attachmentsRestored,
    errors: errors.slice(0, 10),
    message: `${reparsed} email(s) re-processados, ${attachmentsRestored} anexo(s) recuperados, ${notFound} não encontrados.`,
  })
}
