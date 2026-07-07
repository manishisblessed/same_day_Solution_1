import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export async function POST(request: NextRequest) {
  try {
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
