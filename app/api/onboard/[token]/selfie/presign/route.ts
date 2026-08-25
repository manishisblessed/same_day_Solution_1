import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { loadInviteByToken, OPEN_INVITE_STATUSES } from '@/lib/onboarding/invites'
import { isS3Configured, presignPutUrl, buildKycKey, signUploadToken } from '@/services/s3-kyc'
import { extForMime } from '@/lib/onboarding/storage'

export const dynamic = 'force-dynamic'

/**
 * POST /api/onboard/[token]/selfie/presign
 * Body: { contentType }
 * Returns either an S3 presigned PUT (mode 's3') or a Supabase fallback signal
 * (mode 'supabase', client posts base64 to /selfie/complete).
 */
export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const supabase = getSupabaseAdmin()
  const { invite, error } = await loadInviteByToken(supabase, params.token)
  if (error || !invite) return NextResponse.json({ error: error || 'Invite not found' }, { status: 404 })
  if (!OPEN_INVITE_STATUSES.includes(invite.status)) {
    return NextResponse.json({ error: 'This invite is not active' }, { status: 410 })
  }

  const body = await request.json().catch(() => ({}))
  const contentType = String(body.contentType || 'image/jpeg')

  if (!isS3Configured()) {
    return NextResponse.json({ mode: 'supabase' })
  }

  const key = buildKycKey(invite.id, 'selfie', extForMime(contentType))
  const exp = Date.now() + 5 * 60 * 1000
  const uploadUrl = presignPutUrl({ key, contentType, expiresSec: 300 })
  const uploadToken = signUploadToken({ inviteId: invite.id, key, kind: 'selfie', exp })

  return NextResponse.json({
    mode: 's3',
    uploadUrl,
    key,
    uploadToken,
    maxBytes: 5 * 1024 * 1024,
  })
}
