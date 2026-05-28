import type Anthropic from '@anthropic-ai/sdk'

/**
 * Wrap an Anthropic message stream as a Next-compatible Response that
 * emits text deltas as plain text chunks. Callers consume it with
 * res.body!.getReader() and append decoded chunks to whichever UI element
 * should fill in as the model writes.
 */
export function streamAnthropicResponse(
  stream: AsyncIterable<Anthropic.MessageStreamEvent>,
): Response {
  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            controller.enqueue(encoder.encode(event.delta.text))
          }
        }
        controller.close()
      } catch (err) {
        console.error('streamAnthropicResponse error:', err)
        controller.error(err)
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      // Disable buffering on intermediaries — chunks must reach the
      // browser as they're produced.
      'X-Accel-Buffering': 'no',
    },
  })
}

/**
 * Read a streaming text/plain response from one of our /api/ai/* routes,
 * calling onChunk with the cumulative text after each delta. Returns the
 * final accumulated string.
 *
 * Throws if the response is not OK or has no body. 4xx/5xx responses from
 * our routes still come back as JSON; the caller can parse them out of the
 * thrown message.
 */
export async function readTextStream(
  res: Response,
  onChunk: (cumulative: string) => void,
): Promise<string> {
  if (!res.ok || !res.body) {
    const fallback = await res.text().catch(() => '')
    let errorMsg = fallback
    try { errorMsg = (JSON.parse(fallback) as { error?: string }).error ?? fallback } catch { /* keep text */ }
    throw new Error(errorMsg || `HTTP ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let accumulated = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    accumulated += decoder.decode(value, { stream: true })
    onChunk(accumulated)
  }
  return accumulated
}

/**
 * Tolerant JSON-escape unescaper for partial strings during a stream. The
 * model emits draft-reply / compose-draft as { "subject": "...", "body":
 * "..." } and we want to surface body bytes as they arrive without waiting
 * for JSON.parse() to succeed at the end.
 */
export function unescapeJsonString(s: string): string {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

/**
 * Pull "subject" and "body" out of a partial JSON blob using a tolerant
 * regex — works whether the tail is mid-token or not. Returns null for
 * fields that haven't started streaming yet.
 */
export function extractJsonFields(raw: string): { subject: string | null; body: string | null } {
  const subjMatch = raw.match(/"subject"\s*:\s*"((?:[^"\\]|\\.)*)/)
  const bodyMatch = raw.match(/"body"\s*:\s*"((?:[^"\\]|\\.)*)/)
  return {
    subject: subjMatch ? unescapeJsonString(subjMatch[1]) : null,
    body:    bodyMatch ? unescapeJsonString(bodyMatch[1]) : null,
  }
}
