import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

/**
 * GET /api/partner/aeps
 *
 * Returns the partner's AEPS wallet balance, merchant status, and stats.
 */
export async function GET(request: NextRequest) {
  try {
    let authResult
    try {
      authResult = await authenticatePartner(request)
    } catch (error) {
      const e = error as PartnerAuthError
      return NextResponse.json(
        { success: false, error: { code: e.code, message: e.message } },
        { status: e.status }
      )
    }

    const { partner } = authResult
    const aepsAccess = partnerCanUseApi(partner, 'aeps')
    if (!aepsAccess.allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: aepsAccess.message } },
        { status: 403 }
      )
    }

    const supabase = getSupabase()

    const [balanceRes, merchantRes, statsRes] = await Promise.all([
      supabase.rpc('get_wallet_balance_v2', { p_user_id: partner.id, p_wallet_type: 'aeps' }),
      supabase.from('aeps_merchants').select('id, merchant_id, status, onboarding_status').eq('user_id', partner.id).maybeSingle(),
      supabase.from('aeps_transactions').select('id, amount, status, transaction_type').eq('user_id', partner.id).order('created_at', { ascending: false }).limit(100),
    ])

    const aepsBalance = balanceRes.data || 0
    const successTxns = (statsRes.data || []).filter((t: any) => t.status === 'SUCCESS')
    const totalVolume = successTxns.reduce((sum: number, t: any) => sum + (parseFloat(t.amount) || 0), 0)

    return NextResponse.json({
      success: true,
      aeps_wallet_balance: aepsBalance,
      merchant: merchantRes.data ? {
        merchant_id: merchantRes.data.merchant_id,
        status: merchantRes.data.status,
        onboarding_status: merchantRes.data.onboarding_status,
      } : null,
      stats: {
        total_transactions: successTxns.length,
        total_volume: totalVolume,
      },
    })
  } catch (error: any) {
    console.error('[Partner AEPS] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
