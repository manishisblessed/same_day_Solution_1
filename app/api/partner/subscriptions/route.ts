import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

/** GET - My subscription and debit history (retailer / distributor / master_distributor / partner) */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user?.partner_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const role = user.role === 'partner' ? 'retailer' : user.role
    if (!['retailer', 'distributor', 'master_distributor'].includes(role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
    const userId = user.partner_id

    const { data: sub, error: subErr } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('user_role', role)
      .maybeSingle()
    if (subErr) {
      console.error('[Partner Subscriptions GET]', subErr)
      return NextResponse.json({ error: subErr.message }, { status: 500 })
    }

    let items: any[] = []
    let debits: any[] = []
    if (sub?.id) {
      const [itemsRes, debitsRes] = await Promise.all([
        supabaseAdmin
          .from('subscription_items')
          .select('*, subscription_products(name)')
          .eq('subscription_id', sub.id)
          .eq('is_active', true)
          .order('created_at', { ascending: false }),
        supabaseAdmin
          .from('subscription_debits')
          .select('*')
          .eq('subscription_id', sub.id)
          .order('created_at', { ascending: false })
          .limit(50),
      ])
      items = itemsRes.data || []
      debits = debitsRes.data || []
    }

    // For distributors/MDs: also show commissions they earned
    let commissions: any[] = []
    if (['distributor', 'master_distributor'].includes(role)) {
      const { data: c } = await supabaseAdmin
        .from('subscription_commissions')
        .select('*')
        .eq('beneficiary_id', userId)
        .order('created_at', { ascending: false })
        .limit(50)
      commissions = c || []
    }

    // Subscription activity history from activity_logs
    const { data: historyLogs } = await supabaseAdmin
      .from('activity_logs')
      .select('id, activity_type, activity_description, user_id, user_role, status, created_at')
      .eq('activity_category', 'subscription')
      .or(`activity_description.ilike.%${userId}%,metadata->>user_id.eq.${userId},metadata->>distributor_id.eq.${userId},metadata->>retailer_id.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(30)

    return NextResponse.json({
      subscription: sub || null,
      items,
      debits,
      commissions,
      history: historyLogs || [],
    })
  } catch (e: any) {
    console.error('[Partner Subscriptions GET]', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
