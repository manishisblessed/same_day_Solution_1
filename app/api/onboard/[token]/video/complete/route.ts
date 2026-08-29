import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { loadInviteByToken, OPEN_INVITE_STATUSES, upsertVerification } from '@/lib/onboarding/invites'
import { verifyUploadToken, isS3Configured, putObjectToS3, buildKycKey } from '@/services/s3-kyc'
import { uploadOnboardingFile, decodeDataUrl, extForMime } from '@/lib/onboarding/storage'

export const dynamic = 'force-dynamic'

/**
 * POST /api/onboard/[token]/video/complete
 * S3 mode:       { key, uploadToken, durationSec }
 * Supabase mode: { dataUrl, uploadToken, durationSec }
 * Records ONBOARD_VIDEO (status Uploaded).
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
    const payload = verifyUploadToken(String(body.uploadToken || ''))
    if (!payload || payload.inviteId !== invite.id || payload.kind !== 'video') {
      return NextResponse.json({ error: 'Invalid or expired upload token' }, { status: 400 })
    }
    const durationSec = Number(body.durationSec) || 0

    // S3 mode
    if (body.key) {
      if (payload.key !== body.key) {
        return NextResponse.json({ error: 'Upload token does not match key' }, { status: 400 })
      }
      await upsertVerification(supabase, {
        inviteId: invite.id,
        type: 'ONBOARD_VIDEO',
        status: 'Uploaded',
        payload: { storage: 's3', key: body.key, durationSec, uploadedAt: new Date().toISOString() },
      })
      return NextResponse.json({ ok: true, storage: 's3' })
    }

    // Base64 fallback (browser couldn't PUT directly to S3). We still store on
    // S3 — server-side — so KYC media never lands anywhere but the bucket.
    const dataUrl = String(body.dataUrl || '')
    if (!dataUrl) return NextResponse.json({ error: 'No video provided' }, { status: 400 })
    const { buffer, contentType } = decodeDataUrl(dataUrl, 'video/webm')
    if (buffer.length > 26 * 1024 * 1024) {
      return NextResponse.json({ error: 'Video too large' }, { status: 400 })
    }

    if (isS3Configured()) {
      const key = buildKycKey(invite.id, 'video', extForMime(contentType))
      const put = await putObjectToS3({ key, contentType, body: buffer, useKms: true })
      if (!put.ok) {
        return NextResponse.json({ error: `S3 upload failed: ${put.error}` }, { status: 502 })
      }
      await upsertVerification(supabase, {
        inviteId: invite.id,
        type: 'ONBOARD_VIDEO',
        status: 'Uploaded',
        payload: { storage: 's3', key, durationSec, uploadedAt: new Date().toISOString() },
      })
      return NextResponse.json({ ok: true, storage: 's3' })
    }

    // Local/dev only (no S3 configured): keep the wizard usable via Supabase.
    const uploaded = await uploadOnboardingFile(supabase, {
      inviteId: invite.id,
      kind: 'video',
      type: 'liveness',
      buffer,
      contentType,
    })
    if ('error' in uploaded) {
      return NextResponse.json({ error: `Upload failed: ${uploaded.error}` }, { status: 500 })
    }
    await upsertVerification(supabase, {
      inviteId: invite.id,
      type: 'ONBOARD_VIDEO',
      status: 'Uploaded',
      payload: { storage: 'supabase', url: uploaded.url, path: uploaded.path, durationSec, uploadedAt: new Date().toISOString() },
    })
    return NextResponse.json({ ok: true, storage: 'supabase', url: uploaded.url })
  } catch (error: any) {
    console.error('[onboard video/complete] error:', error)
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 })
  }
}
