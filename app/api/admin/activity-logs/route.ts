import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin) {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')))
    const offset = (page - 1) * limit

    const category = searchParams.get('category')
    const userRole = searchParams.get('user_role')
    const userId = searchParams.get('user_id')
    const status = searchParams.get('status')
    const dateFrom = searchParams.get('date_from')
    const dateTo = searchParams.get('date_to')
    const search = searchParams.get('search')

    const supabase = getSupabaseAdmin()

    let query = supabase
      .from('activity_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (category && category !== 'all') query = query.eq('activity_category', category)
    if (userRole && userRole !== 'all') query = query.eq('user_role', userRole)
    if (userId) query = query.eq('user_id', userId)
    if (status && status !== 'all') query = query.eq('status', status)
    if (dateFrom) query = query.gte('created_at', dateFrom)
    if (dateTo) query = query.lte('created_at', dateTo)
    if (search) query = query.or(`activity_description.ilike.%${search}%,activity_type.ilike.%${search}%,user_id.ilike.%${search}%`)

    query = query.range(offset, offset + limit - 1)

    const { data, count, error } = await query

    if (error) {
      console.error('[ActivityLogs] Query error:', error)
      return NextResponse.json({ error: 'Failed to fetch activity logs' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      logs: data || [],
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    })
  } catch (err: any) {
    console.error('[ActivityLogs] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
