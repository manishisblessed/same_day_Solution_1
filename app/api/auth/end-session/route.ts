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
    const { session_token, reason } = body

    if (!session_token) {
      return NextResponse.json({ error: 'session_token required' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    await supabase
      .from('user_sessions')
      .update({
        is_active: false,
        ended_reason: reason || 'logout',
      })
      .eq('session_token', session_token)
      .eq('is_active', true)
      .eq('user_id', user.id)

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[end-session] Error:', err?.message || err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
