import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  try {
    // Per-IP throttle blunts bulk email enumeration ("which accounts have 2FA?").
    const rl = rateLimit(request, RATE_LIMITS.twofaStatus)
    if (rl.limited) return rl.response!

    const { email } = await request.json()

    if (!email) {
      return NextResponse.json({ error: 'email required' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from('user_totp_secrets')
      .select('is_enabled')
      .eq('email', email.toLowerCase().trim())
      .eq('is_enabled', true)
      .maybeSingle()

    if (error) {
      // Fail open — don't block login if table doesn't exist yet
      return NextResponse.json({ enabled: false })
    }

    return NextResponse.json({ enabled: !!data })
  } catch (err: any) {
    console.error('[2fa/status] Error:', err?.message || err)
    return NextResponse.json({ enabled: false })
  }
}
