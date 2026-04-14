import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

/**
 * GET /api/admin/partner-wallet/balance?partner_id=xxx
 * 
 * Fetch partner wallet balance and recent ledger entries.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      )
    }

    if (user.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: 'Admin access required' },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const partnerId = searchParams.get('partner_id')

    if (!partnerId) {
      return NextResponse.json(
        { success: false, error: 'partner_id query parameter is required' },
        { status: 400 }
      )
    }

    const supabase = getSupabase()

    // Get wallet info
    const { data: wallet } = await supabase
      .from('partner_wallets')
      .select('balance, is_frozen, freeze_reason, created_at, updated_at')
      .eq('partner_id', partnerId)
      .maybeSingle()

    // Get balance via RPC (ensures wallet exists)
    const { data: balance } = await supabase.rpc('get_partner_wallet_balance', {
      p_partner_id: partnerId
    })

    // Get recent ledger entries
    const { data: ledger } = await supabase
      .from('partner_wallet_ledger')
      .select('id, transaction_type, amount, credit, debit, opening_balance, closing_balance, reference_id, payout_transaction_id, description, status, created_at')
      .eq('partner_id', partnerId)
      .order('created_at', { ascending: false })
      .limit(20)

    return NextResponse.json({
      success: true,
      data: {
        partner_id: partnerId,
        balance: balance || 0,
        is_frozen: wallet?.is_frozen || false,
        freeze_reason: wallet?.freeze_reason || null,
        wallet_created_at: wallet?.created_at || null,
        ledger: ledger || []
      }
    })
  } catch (error: any) {
    console.error('[Partner Wallet Balance] Error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
