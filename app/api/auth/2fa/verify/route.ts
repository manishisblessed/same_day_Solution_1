import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { decryptSecret, verifyTOTP, verifyBackupCode } from '@/lib/totp'

export async function POST(request: NextRequest) {
  try {
    const { email, code, is_backup } = await request.json()

    if (!email || !code) {
      return NextResponse.json({ error: 'email and code are required' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    const { data: totpRow, error: fetchErr } = await supabase
      .from('user_totp_secrets')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .eq('is_enabled', true)
      .maybeSingle()

    if (fetchErr || !totpRow) {
      return NextResponse.json({ error: '2FA not configured for this account' }, { status: 400 })
    }

    // Try backup code
    if (is_backup) {
      const idx = await verifyBackupCode(code.trim(), totpRow.backup_codes || [])
      if (idx === -1) {
        return NextResponse.json({ error: 'Invalid backup code' }, { status: 400 })
      }
      // Remove used backup code
      const updatedCodes = [...totpRow.backup_codes]
      updatedCodes.splice(idx, 1)
      await supabase
        .from('user_totp_secrets')
        .update({
          backup_codes: updatedCodes,
          last_used_at: new Date().toISOString(),
        })
        .eq('id', totpRow.id)

      return NextResponse.json({
        valid: true,
        backup_codes_remaining: updatedCodes.length,
      })
    }

    // Verify TOTP code
    const secret = await decryptSecret(totpRow.encrypted_secret)
    const valid = verifyTOTP(secret, code.trim())

    if (!valid) {
      return NextResponse.json({ error: 'Invalid verification code' }, { status: 400 })
    }

    await supabase
      .from('user_totp_secrets')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', totpRow.id)

    return NextResponse.json({ valid: true })
  } catch (err: any) {
    console.error('[2fa/verify] Error:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
