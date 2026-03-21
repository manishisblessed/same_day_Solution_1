import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/master-distributor/subscriptions/distributors
 * Returns distributors under this MD with their subscription summary.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'master_distributor' || !user.partner_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { data: distributors, error: distErr } = await supabaseAdmin
      .from('distributors')
      .select('partner_id, name, email, status, created_at')
      .eq('master_distributor_id', user.partner_id)
      .order('name')

    if (distErr) return NextResponse.json({ error: distErr.message }, { status: 500 })

    const distIds = (distributors || []).map((d) => d.partner_id)
    if (distIds.length === 0) {
      return NextResponse.json({ distributors: [], subscriptions: [] })
    }

    const { data: subs } = await supabaseAdmin
      .from('subscriptions')
      .select('user_id, monthly_amount, pos_machine_count, next_billing_date, billing_day, status')
      .eq('user_role', 'distributor')
      .in('user_id', distIds)

    const subByUser = new Map((subs || []).map((s) => [s.user_id, s]))

    const list = (distributors || []).map((d) => ({
      ...d,
      subscription: subByUser.get(d.partner_id) || null,
    }))

    return NextResponse.json({ distributors: list })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
