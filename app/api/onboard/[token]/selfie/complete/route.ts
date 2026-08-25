import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { loadInviteByToken, OPEN_INVITE_STATUSES, upsertVerification } from '@/lib/onboarding/invites'
import { verifyUploadToken } from '@/services/s3-kyc'
import { uploadOnboardingFile, decodeDataUrl } from '@/lib/onboarding/storage'

export const dynamic = 'force-dynamic'

/**
 * POST /api/onboard/[token]/selfie/complete
 * S3 mode:       { key, uploadToken }
 * Supabase mode: { dataUrl }
 * Records DOCUMENT_SELFIE (status Uploaded).
 */
export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const supabase = getSupabaseAdmin()
    const { invite, error } = await loadInviteByToken(supabase, params.token)
    if (error || !invite) return NextResponse.json({ error: error || 'Invite not found' }, { status: 404 })
    if (!OPEN_INVITE_STATUSES.includes(invite.status)) {
      return NextResponse.json({ error: 'This invite is not active' }, { status: 410 })
    }

    const body = await request.json().catch(() => ({}))

    // S3 mode
    if (body.key && body.uploadToken) {
      const payload = verifyUploadToken(String(body.uploadToken))
      if (!payload || payload.inviteId !== invite.id || payload.key !== body.key || payload.kind !== 'selfie') {
        return NextResponse.json({ error: 'Invalid or expired upload token' }, { status: 400 })
      }
      await upsertVerification(supabase, {
        inviteId: invite.id,
        type: 'DOCUMENT_SELFIE',
        status: 'Uploaded',
        payload: { storage: 's3', key: body.key, uploadedAt: new Date().toISOString() },
      })
      return NextResponse.json({ ok: true, storage: 's3' })
    }

    // Supabase fallback (base64)
    const dataUrl = String(body.dataUrl || '')
    if (!dataUrl) return NextResponse.json({ error: 'No selfie provided' }, { status: 400 })
    const { buffer, contentType } = decodeDataUrl(dataUrl, 'image/jpeg')
    if (buffer.length > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Selfie too large (max 5MB)' }, { status: 400 })
    }
    const uploaded = await uploadOnboardingFile(supabase, {
      inviteId: invite.id,
      kind: 'selfie',
      type: 'selfie',
      buffer,
      contentType,
    })
    if ('error' in uploaded) {
      return NextResponse.json({ error: `Upload failed: ${uploaded.error}` }, { status: 500 })
    }
    await upsertVerification(supabase, {
      inviteId: invite.id,
      type: 'DOCUMENT_SELFIE',
      status: 'Uploaded',
      payload: { storage: 'supabase', url: uploaded.url, path: uploaded.path, uploadedAt: new Date().toISOString() },
    })
    return NextResponse.json({ ok: true, storage: 'supabase', url: uploaded.url })
  } catch (error: any) {
    console.error('[onboard selfie/complete] error:', error)
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 })
  }
}
