import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

// Mark this route as dynamic (uses cookies for authentication)
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Get current user (server-side) with fallback
    const { user, method } = await getCurrentUserWithFallback(request)
    console.log('[Wallet Transactions] Auth method:', method, '| User:', user?.email || 'none')
    
    if (!user || !user.partner_id) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }

    const PARTNER_ROLES = ['partner', 'master_partner', 'sub_partner']
    const isPartner = PARTNER_ROLES.includes(user.role)
    if (user.role !== 'retailer' && !isPartner) {
      return NextResponse.json(
        { error: 'Forbidden: Only retailers and partners have wallets' },
        { status: 403 }
      )
    }

    const supabase = getSupabaseAdmin()
    const { searchParams } = new URL(request.url)

    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')
    const transactionType = searchParams.get('type') || undefined

    // Partners' wallet movements live in partner_wallet_ledger, keyed by partners.id.
    let query = isPartner
      ? supabase
          .from('partner_wallet_ledger')
          .select('*', { count: 'exact' })
          .eq('partner_id', user.partner_id)
          .order('created_at', { ascending: false })
      : supabase
          .from('wallet_ledger')
          .select('*', { count: 'exact' })
          .eq('retailer_id', user.partner_id)
          .order('created_at', { ascending: false })

    if (transactionType) {
      query = query.eq('transaction_type', transactionType)
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query

    if (error) {
      console.error('Error fetching wallet transactions:', error)
      return NextResponse.json(
        { error: 'Failed to fetch wallet transactions' },
        { status: 500 }
      )
    }

    // Get current balance
    const { data: balance } = isPartner
      ? await supabase.rpc('get_partner_wallet_balance', { p_partner_id: user.partner_id })
      : await supabase.rpc('get_wallet_balance', { p_retailer_id: user.partner_id })

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, {
      activity_type: 'wallet_transactions_view',
      activity_category: 'wallet',
      activity_description: `${user.role} viewed wallet transactions`,
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      transactions: data || [],
      total: count || 0,
      balance: balance || 0,
      limit,
      offset,
    })
  } catch (error: any) {
    console.error('Error in wallet transactions API:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

