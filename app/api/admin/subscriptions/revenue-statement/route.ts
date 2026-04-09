import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/subscriptions/revenue-statement
 * Returns ledger entries for the subscription revenue wallet.
 * Supports ?limit=N (default 100).
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const revenueUserId = process.env.SUBSCRIPTION_REVENUE_USER_ID
    if (!revenueUserId) {
      return NextResponse.json({ entries: [], message: 'SUBSCRIPTION_REVENUE_USER_ID not configured' })
    }

    const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '100'), 500)

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('wallet_ledger')
      .select('id, retailer_id, user_role, wallet_type, fund_category, service_type, transaction_type, credit, debit, opening_balance, closing_balance, balance_after, description, reference_id, status, created_at')
      .eq('retailer_id', revenueUserId)
      .in('service_type', ['subscription', 'settlement'])
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      return NextResponse.json({ entries: [], error: error.message })
    }

    return NextResponse.json({ entries: data || [], user_id: revenueUserId })
  } catch (e: any) {
    console.error('[Revenue statement]', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
