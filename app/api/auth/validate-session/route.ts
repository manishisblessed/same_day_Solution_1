import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { getCurrentUserWithFallback } from '@/lib/auth-server'

export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { session_token } = body

    if (!session_token) {
      return NextResponse.json({ error: 'session_token required' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from('user_sessions')
      .select('id, is_active, ended_reason, expires_at')
      .eq('session_token', session_token)
      .maybeSingle()

    if (error) {
      console.error('[validate-session] DB error:', error)
      return NextResponse.json({ valid: false, reason: 'validation_error' })
    }

    if (!data) {
      return NextResponse.json({ valid: false, reason: 'not_found' })
    }

    if (!data.is_active) {
      return NextResponse.json({
        valid: false,
        reason: data.ended_reason || 'ended',
      })
    }

    if (new Date(data.expires_at) < new Date()) {
      // Expire it
      await supabase
        .from('user_sessions')
        .update({ is_active: false, ended_reason: 'inactivity' })
        .eq('id', data.id)

      return NextResponse.json({ valid: false, reason: 'expired' })
    }

    // Update last_active_at as heartbeat
    await supabase
      .from('user_sessions')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', data.id)

    return NextResponse.json({ valid: true })
  } catch (err: any) {
    console.error('[validate-session] Error:', err?.message || err)
    return NextResponse.json({ valid: false, reason: 'validation_error' })
  }
}
