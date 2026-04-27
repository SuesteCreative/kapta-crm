import { supabase } from '@/lib/supabase'

const BUCKET = 'email-attachments'
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024

export interface UploadedAttachment {
  name: string
  url: string
  mime: string
  size: number
}

function sanitiseFilename(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 120)
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function uploadAttachment(file: File): Promise<UploadedAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Ficheiro ${file.name} excede 15MB`)
  }

  const path = `outbound/${Date.now()}-${randomHex(4)}-${sanitiseFilename(file.name)}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    })

  if (error) throw new Error(`Upload falhou: ${error.message}`)

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)

  return {
    name: file.name,
    url: publicUrl,
    mime: file.type || 'application/octet-stream',
    size: file.size,
  }
}
