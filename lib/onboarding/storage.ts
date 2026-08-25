/**
 * Upload helper for onboarding wizard media into the existing Supabase
 * `partner-documents` bucket (public URLs), matching the pattern in
 * app/api/admin/upload-document/route.ts.
 */

const BUCKET = 'partner-documents'

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'video/webm': 'webm',
  'video/mp4': 'mp4',
}

export function extForMime(mime: string): string {
  return EXT_BY_MIME[mime] || 'bin'
}

/**
 * Decode a data URL or raw base64 string into a Buffer + detected content type.
 */
export function decodeDataUrl(input: string, fallbackMime = 'application/octet-stream'): {
  buffer: Buffer
  contentType: string
} {
  const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(input)
  if (match) {
    return { buffer: Buffer.from(match[2], 'base64'), contentType: match[1] }
  }
  return { buffer: Buffer.from(input, 'base64'), contentType: fallbackMime }
}

/**
 * Upload a buffer to partner-documents and return its public URL.
 */
export async function uploadOnboardingFile(
  supabase: any,
  args: {
    inviteId: string
    kind: string // e.g. 'documents', 'selfie', 'video'
    type: string // doc type or media label
    buffer: Buffer
    contentType: string
  }
): Promise<{ url: string; path: string } | { error: string }> {
  const ext = extForMime(args.contentType)
  const safeType = args.type.toLowerCase().replace(/[^a-z0-9_-]/g, '')
  const path = `onboarding/${args.inviteId}/${args.kind}/${safeType}-${Date.now()}.${ext}`

  const { error } = await supabase.storage.from(BUCKET).upload(path, args.buffer, {
    contentType: args.contentType,
    upsert: true,
  })
  if (error) return { error: error.message }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return { url: data.publicUrl, path }
}
