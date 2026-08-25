import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { loadInviteByToken, OPEN_INVITE_STATUSES } from '@/lib/onboarding/invites'
import { isS3Configured, presignPutUrl, buildKycKey, signUploadToken } from '@/services/s3-kyc'
import { extForMime } from '@/lib/onboarding/storage'
import { getEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * POST /api/onboard/[token]/video/initiate
 * Body: { consent: true, contentType }
 * Issues a 4-digit liveness challenge + upload target (S3 presign or Supabase
 * fallback). The challenge is embedded in the upload token so /complete can
 * validate it without extra storage.
 */
export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const supabase = getSupabaseAdmin()
  const { invite, error } = await loadInviteByToken(supabase, params.token)
  if (error || !invite) return NextResponse.json({ error: error || 'Invite not found' }, { status: 404 })
  if (!OPEN_INVITE_STATUSES.includes(invite.status)) {
    return NextResponse.json({ error: 'This invite is not active' }, { status: 410 })
  }

  const body = await request.json().catch(() => ({}))
  if (body.consent !== true) {
    return NextResponse.json({ error: 'Consent is required to record the liveness video' }, { status: 400 })
  }
  const contentType = String(body.contentType || 'video/webm')
  const challengeCode = String(crypto.randomInt(0, 10000)).padStart(4, '0')
  const maxBytes = parseInt(getEnv('KYC_VIDEO_MAX_BYTES') || '26214400', 10)
  const maxDurationSec = parseInt(getEnv('KYC_VIDEO_MAX_DURATION_SEC') || '15', 10)
  const prompt = `Please look at the camera and clearly read this number aloud: ${challengeCode}`

  const exp = Date.now() + 10 * 60 * 1000

  if (!isS3Configured()) {
    // Supabase fallback: bind challenge to a token even without a key.
    const uploadToken = signUploadToken({ inviteId: invite.id, key: `challenge:${challengeCode}`, kind: 'video', exp })
    return NextResponse.json({
      mode: 'supabase',
      prompt,
      challengeCode,
      uploadToken,
      maxBytes,
      maxDurationSec,
    })
  }

  const key = buildKycKey(invite.id, 'video', extForMime(contentType))
  const uploadUrl = presignPutUrl({ key, contentType, expiresSec: 600 })
  const uploadToken = signUploadToken({ inviteId: invite.id, key, kind: 'video', exp })

  return NextResponse.json({
    mode: 's3',
    uploadUrl,
    key,
    uploadToken,
    prompt,
    challengeCode,
    maxBytes,
    maxDurationSec,
  })
}
