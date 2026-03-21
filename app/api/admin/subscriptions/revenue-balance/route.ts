import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/subscriptions/revenue-balance
 * Returns the subscription revenue wallet balance when SUBSCRIPTION_REVENUE_USER_ID is configured.
 * Admin only.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const revenueUserId = process.env.SUBSCRIPTION_REVENUE_USER_ID
    const revenueUserRole = process.env.SUBSCRIPTION_REVENUE_USER_ROLE || 'master_distributor'

    if (!revenueUserId || !['retailer', 'distributor', 'master_distributor'].includes(revenueUserRole)) {
      return NextResponse.json({
        configured: false,
        balance: null,
        message: 'Set SUBSCRIPTION_REVENUE_USER_ID and SUBSCRIPTION_REVENUE_USER_ROLE to see subscription revenue wallet.',
      })
    }

    const supabase = getSupabaseAdmin()
    const { data: balance, error } = await supabase.rpc('get_wallet_balance_v2', {
      p_user_id: revenueUserId,
      p_wallet_type: 'primary',
    })

    if (error) {
      return NextResponse.json({
        configured: true,
        balance: null,
        error: error.message,
      })
    }

    return NextResponse.json({
      configured: true,
      balance: Number(balance) || 0,
      user_id: revenueUserId,
      user_role: revenueUserRole,
    })
  } catch (e: any) {
    console.error('[Revenue balance]', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
