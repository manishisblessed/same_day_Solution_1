import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { isAdminOnly, isAdminOrFinance } from '@/lib/auth-roles'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin) {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    }
    if (!isAdminOrFinance(admin)) {
      return NextResponse.json({ error: 'Admin or finance access required' }, { status: 403 })
    }

    const status = request.nextUrl.searchParams.get('status') || 'open'
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('settlement_alerts')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) {
      console.error('[SettlementAlerts] Fetch error:', error)
      return NextResponse.json({ error: 'Failed to fetch alerts' }, { status: 500 })
    }

    return NextResponse.json({ success: true, alerts: data || [] })
  } catch (err: any) {
    console.error('[SettlementAlerts] GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin) {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    }
    if (!isAdminOnly(admin)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const ids: string[] = Array.isArray(body.ids) ? body.ids : []
    if (ids.length === 0) {
      return NextResponse.json({ error: 'ids array required' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('settlement_alerts')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        resolved_by: admin.partner_id || admin.id,
      })
      .in('id', ids)
      .eq('status', 'open')
      .select('id')

    if (error) {
      console.error('[SettlementAlerts] Resolve error:', error)
      return NextResponse.json({ error: 'Failed to resolve alerts' }, { status: 500 })
    }

    return NextResponse.json({ success: true, resolved: (data || []).length })
  } catch (err: any) {
    console.error('[SettlementAlerts] PATCH error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
