// Client-side image compression for inline email images (screenshots).
// Runs in the browser only (uses canvas / createImageBitmap).
//
// Strategy tuned for screenshots, not photos:
//  - Downscale so the longest side <= maxDim (kills retina bloat).
//  - PNG stays PNG (crisp text/UI edges, no JPEG smearing) when small enough.
//  - Only fall back to JPEG when the PNG is still heavy, to bound size.
//  - Output stays PNG/JPEG — WebP is smaller but Outlook won't render it inline.

export interface CompressOptions {
  /** Max width/height in px. Larger images are scaled down to fit. */
  maxDim?: number
  /** JPEG quality 0..1 used for photo sources and the PNG fallback. */
  jpegQuality?: number
  /** If a re-encoded PNG exceeds this, fall back to JPEG to bound size. */
  pngMaxBytes?: number
}

const DEFAULTS: Required<CompressOptions> = {
  maxDim: 1600,
  jpegQuality: 0.85,
  pngMaxBytes: 600 * 1024,
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality))
}

/**
 * Compress/downscale an image File for inline use. Returns a new File, or the
 * original untouched if it's not a raster image, decoding fails, or the result
 * wouldn't be smaller. Never throws — falls back to the original on any error.
 */
export async function compressImage(file: File, opts: CompressOptions = {}): Promise<File> {
  // Skip non-images, vectors, and animated GIFs (canvas would flatten them).
  if (!file.type.startsWith('image/')) return file
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file

  const { maxDim, jpegQuality, pngMaxBytes } = { ...DEFAULTS, ...opts }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
  } catch {
    return file // decode failed → upload original
  }

  try {
    const { width, height } = bitmap
    const scale = Math.min(1, maxDim / Math.max(width, height))
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)

    const isPng = file.type === 'image/png'
    let blob: Blob | null
    let outType: string

    if (isPng) {
      blob = await canvasToBlob(canvas, 'image/png')
      outType = 'image/png'
      if (blob && blob.size > pngMaxBytes) {
        const jpeg = await canvasToBlob(canvas, 'image/jpeg', jpegQuality)
        if (jpeg && jpeg.size < blob.size) { blob = jpeg; outType = 'image/jpeg' }
      }
    } else {
      blob = await canvasToBlob(canvas, 'image/jpeg', jpegQuality)
      outType = 'image/jpeg'
    }

    if (!blob) return file
    // No downscale happened and we didn't shrink the bytes → keep original.
    if (scale === 1 && blob.size >= file.size) return file

    const base = file.name.replace(/\.[^.]+$/, '') || 'image'
    const ext = outType === 'image/png' ? 'png' : 'jpg'
    return new File([blob], `${base}.${ext}`, { type: outType, lastModified: file.lastModified })
  } finally {
    bitmap.close?.()
  }
}
