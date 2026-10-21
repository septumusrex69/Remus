/** Client-side image helpers for slip capture. */

const EXT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
}

/** MIME type for a file, falling back to its extension when the browser leaves `type` empty. */
export function inferFileType(file: File): string {
  if (file.type) return file.type
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TYPES[ext] ?? 'application/octet-stream'
}

/** Returns the file with a correct `type`, re-wrapping it only when the browser left it empty. */
export function withFileType(file: File): File {
  if (file.type) return file
  const type = inferFileType(file)
  return new File([file], file.name, { type, lastModified: file.lastModified })
}

// HEIC/HEIF is attempted too: Safari can decode it, and converting to JPEG lets the AI read it.
const COMPRESSIBLE = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Downscales a phone photo so its long edge is at most `maxEdge` px and re-encodes it as JPEG.
 * PDFs, HEIC (when the browser can't decode it) and anything else pass through unchanged, as does
 * any image whose re-encode isn't actually smaller. Never throws: falls back to the original.
 */
export async function compressImage(input: File, { maxEdge = 2000, quality = 0.82 } = {}): Promise<File> {
  const file = withFileType(input)
  if (!COMPRESSIBLE.includes(file.type)) return file
  try {
    const img = await decode(file)
    try {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return file
      // JPEG has no alpha; paint white under transparent PNGs.
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img.source, 0, 0, w, h)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
      const isHeic = file.type === 'image/heic' || file.type === 'image/heif'
      if (!blob || (!isHeic && blob.size >= file.size)) return file
      const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
      return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified })
    } finally {
      img.close()
    }
  } catch {
    return file
  }
}
