import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { generateSecret, generateTOTPUri, encryptSecret, generateBackupCodes, hashBackupCodes } from '@/lib/totp'
import QRCode from 'qrcode'

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const secret = generateSecret()
    const uri = generateTOTPUri(secret, user.email)
    const qrCodeDataUrl = await QRCode.toDataURL(uri, { width: 256, margin: 1 })
    const backupCodes = generateBackupCodes(8)
    const hashedCodes = await hashBackupCodes(backupCodes)
    const encrypted = await encryptSecret(secret)

    const supabase = getSupabaseAdmin()

    // Upsert: replace any existing unverified setup
    await supabase
      .from('user_totp_secrets')
      .delete()
      .eq('user_id', user.id)
      .eq('is_enabled', false)

    const { error } = await supabase
      .from('user_totp_secrets')
      .upsert({
        user_id: user.id,
        email: user.email,
        encrypted_secret: encrypted,
        is_enabled: false,
        backup_codes: hashedCodes,
        created_at: new Date().toISOString(),
        verified_at: null,
      }, { onConflict: 'user_id' })

    if (error) {
      console.error('[2fa/setup] DB error:', error)
      return NextResponse.json({ error: 'Failed to setup 2FA' }, { status: 500 })
    }

    return NextResponse.json({
      secret,
      qr_code: qrCodeDataUrl,
      uri,
      backup_codes: backupCodes,
    })
  } catch (err: any) {
    console.error('[2fa/setup] Error:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
