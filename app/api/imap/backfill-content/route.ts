import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { decodeLegacyEmailContent, looksLikeLegacyEmail } from '@/lib/decode-legacy-email'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * One-shot backfill: re-decode interactions whose content was stored before
 * the mailparser switch — MIME boundaries and quoted-printable sequences
 * still present in the text.
 *
 * POST { preview?: boolean }
 * preview=true → counts only, no writes
 */
export async function POST(req: NextRequest) {
  const sessionCookie = req.cookies.get('kapta_session')?.value
  if (!sessionCookie || sessionCookie !== process.env.AUTH_SESSION_TOKEN) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { preview } = (await req.json().catch(() => ({}))) as { preview?: boolean }

  const supabase = createServiceClient()

  let scanned = 0
  let affected = 0
  let updated = 0
  let pageSize = 500
  let from = 0

  while (true) {
    const { data: rows, error } = await supabase
      .from('interactions')
      .select('id, content')
      .eq('type', 'email')
      .not('content', 'is', null)
      .range(from, from + pageSize - 1)
      .order('id', { ascending: true })

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    if (!rows || rows.length === 0) break

    scanned += rows.length

    const toUpdate: Array<{ id: string; content: string }> = []

    for (const r of rows) {
      if (!r.content || !looksLikeLegacyEmail(r.content)) continue
      const decoded = decodeLegacyEmailContent(r.content)
      if (!decoded || decoded === r.content) continue
      affected++
      toUpdate.push({ id: r.id, content: decoded })
    }

    if (!preview && toUpdate.length > 0) {
      // Parallel updates — Supabase doesn't offer a single-statement bulk UPDATE for
      // different values per row, so we fire them in chunks.
      const chunks: Array<Array<{ id: string; content: string }>> = []
      for (let i = 0; i < toUpdate.length; i += 20) {
        chunks.push(toUpdate.slice(i, i + 20))
      }
      for (const chunk of chunks) {
        await Promise.all(
          chunk.map((u) =>
            supabase.from('interactions').update({ content: u.content }).eq('id', u.id)
          )
        )
        updated += chunk.length
      }
    }

    if (rows.length < pageSize) break
    from += pageSize
  }

  return NextResponse.json({
    ok: true,
    preview: !!preview,
    scanned,
    affected,
    updated,
    message: preview
      ? `${affected} email(s) com encoding partido em ${scanned} verificados.`
      : `${updated} email(s) corrigidos de ${scanned} verificados.`,
  })
}
