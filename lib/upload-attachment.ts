const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
export { MAX_ATTACHMENT_BYTES }

export interface UploadedAttachment {
  name: string
  url: string
  mime: string
  size: number
}

// Uploads via the server route (service role) — the anon client cannot insert
// into the Storage bucket because of RLS, so direct client uploads silently fail.
export async function uploadAttachment(file: File): Promise<UploadedAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Ficheiro ${file.name} excede 15MB`)
  }

  const form = new FormData()
  form.append('file', file, file.name)

  const res = await fetch('/api/upload/attachment', { method: 'POST', body: form })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `Upload falhou (${res.status})`)

  return {
    name: json.name,
    url: json.url,
    mime: json.mime,
    size: json.size,
  }
}
