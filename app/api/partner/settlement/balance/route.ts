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
 * GET /api/partner/settlement/balance
 * Get partner wallet balance for settlement transfers
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
    const access = partnerCanUseApi(partner, 'settlement')
    if (!access.allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: access.message } },
        { status: 403 }
      )
    }

    const supabase = getSupabase()

    const { data: wallet } = await supabase
      .from('partner_wallets')
      .select('balance, is_frozen, freeze_reason, updated_at')
      .eq('partner_id', partner.id)
      .maybeSingle()

    const { data: balance } = await supabase.rpc('get_partner_wallet_balance', {
      p_partner_id: partner.id
    })

    return NextResponse.json({
      success: true,
      balance: balance || 0,
      is_frozen: wallet?.is_frozen || false,
      freeze_reason: wallet?.freeze_reason || null,
      last_updated: wallet?.updated_at || null,
    })
  } catch (error: any) {
    console.error('[Partner Settlement Balance] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
