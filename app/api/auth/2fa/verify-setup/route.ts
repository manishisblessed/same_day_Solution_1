import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { decryptSecret, verifyTOTP } from '@/lib/totp'

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { code } = await request.json()
    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'code is required' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    const { data: totpRow, error: fetchErr } = await supabase
      .from('user_totp_secrets')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()

    if (fetchErr || !totpRow) {
      return NextResponse.json({ error: 'No 2FA setup found. Please start setup first.' }, { status: 400 })
    }

    if (totpRow.is_enabled) {
      return NextResponse.json({ error: '2FA is already enabled' }, { status: 400 })
    }

    const secret = await decryptSecret(totpRow.encrypted_secret)
    const valid = verifyTOTP(secret, code.trim())

    if (!valid) {
      return NextResponse.json({ error: 'Invalid code. Please check your authenticator app and try again.' }, { status: 400 })
    }

    // Mark as enabled
    await supabase
      .from('user_totp_secrets')
      .update({
        is_enabled: true,
        verified_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)

    return NextResponse.json({ success: true, message: '2FA enabled successfully' })
  } catch (err: any) {
    console.error('[2fa/verify-setup] Error:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
