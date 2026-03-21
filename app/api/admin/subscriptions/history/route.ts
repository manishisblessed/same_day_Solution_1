import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/subscriptions/history?limit=30
 * Returns recent subscription-related activity logs for the admin Subscriptions tab.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const url = new URL(request.url)
    const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '30'))

    const { data, error } = await supabaseAdmin
      .from('activity_logs')
      .select('id, activity_type, activity_description, user_id, user_role, status, metadata, created_at')
      .eq('activity_category', 'subscription')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ logs: data || [] })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
