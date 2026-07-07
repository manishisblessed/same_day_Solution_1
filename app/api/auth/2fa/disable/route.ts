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
    if (!code) {
      return NextResponse.json({ error: 'Current TOTP code required to disable 2FA' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    const { data: totpRow } = await supabase
      .from('user_totp_secrets')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_enabled', true)
      .maybeSingle()

    if (!totpRow) {
      return NextResponse.json({ error: '2FA is not enabled' }, { status: 400 })
    }

    const secret = await decryptSecret(totpRow.encrypted_secret)
    const valid = verifyTOTP(secret, code.trim())

    if (!valid) {
      return NextResponse.json({ error: 'Invalid code. Cannot disable 2FA.' }, { status: 400 })
    }

    await supabase
      .from('user_totp_secrets')
      .delete()
      .eq('user_id', user.id)

    return NextResponse.json({ success: true, message: '2FA has been disabled' })
  } catch (err: any) {
    console.error('[2fa/disable] Error:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
