import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { loadInviteByToken, OPEN_INVITE_STATUSES, OTP_TABLE } from '@/lib/onboarding/invites'
import { sendOtp, hashOtp } from '@/services/otp'

export const dynamic = 'force-dynamic'

/**
 * POST /api/onboard/[token]/otp/send
 * Body: { channel: 'SMS' | 'EMAIL' }
 * Sends an OTP to the invite's phone (Twilio Verify) or email (Resend).
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
    const channel = body.channel === 'EMAIL' ? 'EMAIL' : 'SMS'

    // Already verified? short-circuit.
    if (channel === 'SMS' && invite.phone_verified_at) {
      return NextResponse.json({ ok: true, alreadyVerified: true })
    }
    if (channel === 'EMAIL' && invite.email_verified_at) {
      return NextResponse.json({ ok: true, alreadyVerified: true })
    }

    const destination = channel === 'SMS' ? invite.phone : invite.email
    const result = await sendOtp(channel, destination, { name: invite.name || undefined })

    if (!result.ok) {
      return NextResponse.json({ error: result.error || 'Failed to send OTP' }, { status: 502 })
    }

    // Persist a code hash for EMAIL (and for mocked SMS) so we can verify later.
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    if (result.emailCode) {
      await supabase.from(OTP_TABLE).insert([
        {
          invite_id: invite.id,
          channel,
          code_hash: hashOtp(result.emailCode),
          expires_at: expiresAt,
        },
      ])
    } else if (result.provider === 'mock' && channel === 'SMS') {
      await supabase.from(OTP_TABLE).insert([
        {
          invite_id: invite.id,
          channel,
          code_hash: hashOtp('123456'),
          expires_at: expiresAt,
        },
      ])
    }

    return NextResponse.json({
      ok: true,
      provider: result.provider,
      channel,
      expiresAt,
      mock: result.provider === 'mock',
    })
  } catch (error: any) {
    console.error('[onboard otp/send] error:', error)
    return NextResponse.json({ error: error.message || 'Failed to send OTP' }, { status: 500 })
  }
}
