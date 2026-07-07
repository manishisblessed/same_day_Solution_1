import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { session_token, geo_latitude, geo_longitude } = body

    if (!session_token) {
      return NextResponse.json({ error: 'session_token required' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown'
    const ua = request.headers.get('user-agent') || 'unknown'

    // Deactivate ALL existing active sessions for this user (single-session enforcement)
    await supabase
      .from('user_sessions')
      .update({ is_active: false, ended_reason: 'replaced' })
      .eq('user_id', user.id)
      .eq('is_active', true)

    // Insert the new session
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24h max

    const { error: insertError } = await supabase
      .from('user_sessions')
      .insert({
        user_id: user.id,
        email: user.email,
        role: user.role,
        session_token,
        ip_address: ip,
        user_agent: ua,
        geo_latitude: geo_latitude || null,
        geo_longitude: geo_longitude || null,
        expires_at: expiresAt,
      })

    if (insertError) {
      console.error('[register-session] Insert error:', insertError)
      return NextResponse.json({ error: 'Failed to register session' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[register-session] Error:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
