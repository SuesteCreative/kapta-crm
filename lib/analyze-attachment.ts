import Anthropic from '@anthropic-ai/sdk'

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const MAX_ANALYSIS_BYTES = 5 * 1024 * 1024 // 5 MB

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

/**
 * Analyze a file buffer with Claude and return a 1-3 sentence business-relevant summary.
 * Returns a fallback string if analysis fails or file is too large.
 */
export async function analyzeAttachment(
  buffer: Buffer,
  { mime, name, size }: { mime: string; name: string; size: number }
): Promise<string> {
  if (size > MAX_ANALYSIS_BYTES) {
    return `${name} (${(size / 1024 / 1024).toFixed(1)} MB — too large for AI analysis)`
  }

  try {
    // ── Images → Claude vision ──
    if (IMAGE_MIMES.has(mime)) {
      const validMime = mime as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: validMime, data: buffer.toString('base64') },
            },
            {
              type: 'text',
              text: 'Describe this image in 2-3 sentences, focusing on business-relevant content such as errors, invoices, contracts, screenshots of software, charts, or documents. If it is not business relevant, just say what it is briefly.',
            },
          ],
        }],
      })
      const block = message.content.find((c) => c.type === 'text')
      return block && block.type === 'text' ? block.text.trim() : name
    }

    // ── PDFs → extract text → Claude ──
    if (mime === 'application/pdf') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
        const data = await pdfParse(buffer)
        const pdfText = data.text.trim().slice(0, 6000)
        if (!pdfText) return `PDF document: ${name} (no extractable text)`

        const message = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: `Summarise this PDF document in 2-3 sentences, focusing on business-relevant details (amounts, dates, parties, purpose):\n\n${pdfText}`,
          }],
        })
        const block = message.content.find((c) => c.type === 'text')
      return block && block.type === 'text' ? block.text.trim() : name
      } catch {
        return `PDF document: ${name}`
      }
    }

    // ── Text-like files ──
    const isTextLike = mime.startsWith('text/') || mime.includes('json') || mime.includes('xml') || mime.includes('csv')
    if (isTextLike) {
      const text = buffer.toString('utf8').slice(0, 3000)
      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `Summarise this file in 1-2 sentences, focusing on business-relevant content:\n\n${text}`,
        }],
      })
      const block = message.content.find((c) => c.type === 'text')
      return block && block.type === 'text' ? block.text.trim() : name
    }

    // ── Unknown binary ──
    const ext = name.includes('.') ? name.split('.').pop()?.toUpperCase() : 'file'
    return `${ext} file: ${name} (${(size / 1024).toFixed(0)} KB)`
  } catch (err) {
    console.error('analyzeAttachment error:', name, err)
    return name
  }
}
