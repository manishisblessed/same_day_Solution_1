import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/distributor/subscriptions/retailers
 * Returns retailers under this distributor with their subscription summary.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'distributor' || !user.partner_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { data: retailers, error: retErr } = await supabaseAdmin
      .from('retailers')
      .select('partner_id, name, email, status, created_at')
      .eq('distributor_id', user.partner_id)
      .order('name')

    if (retErr) return NextResponse.json({ error: retErr.message }, { status: 500 })

    const retailerIds = (retailers || []).map((r) => r.partner_id)
    if (retailerIds.length === 0) {
      return NextResponse.json({ retailers: [] })
    }

    const { data: subs } = await supabaseAdmin
      .from('subscriptions')
      .select('user_id, monthly_amount, pos_machine_count, next_billing_date, billing_day, status')
      .eq('user_role', 'retailer')
      .in('user_id', retailerIds)

    const subByUser = new Map((subs || []).map((s) => [s.user_id, s]))

    const list = (retailers || []).map((r) => ({
      ...r,
      subscription: subByUser.get(r.partner_id) || null,
    }))

    return NextResponse.json({ retailers: list })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
