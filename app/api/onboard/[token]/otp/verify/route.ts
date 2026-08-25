import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { loadInviteByToken, OPEN_INVITE_STATUSES, INVITE_TABLE, OTP_TABLE } from '@/lib/onboarding/invites'
import { verifyOtp } from '@/services/otp'

export const dynamic = 'force-dynamic'

/**
 * POST /api/onboard/[token]/otp/verify
 * Body: { channel: 'SMS' | 'EMAIL', code: string }
 * Marks phone_verified_at / email_verified_at on success.
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
    const code = String(body.code || '').trim()
    if (!/^\d{4,8}$/.test(code)) {
      return NextResponse.json({ error: 'Enter the code you received' }, { status: 400 })
    }

    if (channel === 'SMS' && invite.phone_verified_at) return NextResponse.json({ ok: true, alreadyVerified: true })
    if (channel === 'EMAIL' && invite.email_verified_at) return NextResponse.json({ ok: true, alreadyVerified: true })

    // Load latest stored OTP (for EMAIL / mock SMS). Twilio SMS verifies remotely.
    const { data: otpRows } = await supabase
      .from(OTP_TABLE)
      .select('*')
      .eq('invite_id', invite.id)
      .eq('channel', channel)
      .is('verified_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
    const otpRow = otpRows && otpRows[0]

    if (otpRow) {
      if (new Date(otpRow.expires_at).getTime() < Date.now()) {
        return NextResponse.json({ error: 'Code expired. Please request a new one.' }, { status: 400 })
      }
      if (otpRow.attempts >= 5) {
        return NextResponse.json({ error: 'Too many attempts. Request a new code.' }, { status: 429 })
      }
    }

    const destination = channel === 'SMS' ? invite.phone : invite.email
    const result = await verifyOtp(channel, destination, code, otpRow?.code_hash)

    if (!result.ok) {
      if (otpRow) {
        await supabase
          .from(OTP_TABLE)
          .update({ attempts: (otpRow.attempts || 0) + 1 })
          .eq('id', otpRow.id)
      }
      return NextResponse.json({ error: result.error || 'Incorrect code' }, { status: 400 })
    }

    const now = new Date().toISOString()
    if (otpRow) {
      await supabase.from(OTP_TABLE).update({ verified_at: now }).eq('id', otpRow.id)
    }
    await supabase
      .from(INVITE_TABLE)
      .update({
        [channel === 'SMS' ? 'phone_verified_at' : 'email_verified_at']: now,
        updated_at: now,
      })
      .eq('id', invite.id)

    return NextResponse.json({ ok: true, channel })
  } catch (error: any) {
    console.error('[onboard otp/verify] error:', error)
    return NextResponse.json({ error: error.message || 'Failed to verify OTP' }, { status: 500 })
  }
}
