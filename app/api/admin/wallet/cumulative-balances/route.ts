import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { isAdminOrFinance } from '@/lib/auth-roles'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

type RoleBreakdown = {
  retailer: number
  distributor: number
  master_distributor: number
  partner: number
  total: number
  wallet_count: number
}

const emptyBreakdown = (): RoleBreakdown => ({
  retailer: 0,
  distributor: 0,
  master_distributor: 0,
  partner: 0,
  total: 0,
  wallet_count: 0,
})

/**
 * GET /api/admin/wallet/cumulative-balances
 * Cumulative wallet balances across the entire system (admin/finance only):
 * - primary / aeps wallets from `wallets`, broken down by user_role (RT/DT/MD/Partner)
 * - partner API wallets from `partner_wallets`
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || !isAdminOrFinance(user)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const supabase = getSupabaseAdmin()
    const primary = emptyBreakdown()
    const aeps = emptyBreakdown()

    const pageSize = 1000
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from('wallets')
        .select('user_role, wallet_type, balance')
        .range(from, from + pageSize - 1)

      if (error) {
        console.error('[cumulative-balances] wallets', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      for (const w of data || []) {
        const bucket = w.wallet_type === 'aeps' ? aeps : primary
        const bal = Number(w.balance) || 0
        bucket.total += bal
        bucket.wallet_count += 1
        if (w.user_role === 'retailer') bucket.retailer += bal
        else if (w.user_role === 'distributor') bucket.distributor += bal
        else if (w.user_role === 'master_distributor') bucket.master_distributor += bal
        else if (w.user_role === 'partner') bucket.partner += bal
      }

      if (!data || data.length < pageSize) break
    }

    // Partner API wallets (separate system, single wallet per partner)
    let partnerTotal = 0
    let partnerCount = 0
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from('partner_wallets')
        .select('balance')
        .range(from, from + pageSize - 1)

      if (error) {
        // Table may not exist in some environments — report zero instead of failing
        console.error('[cumulative-balances] partner_wallets', error)
        break
      }

      for (const w of data || []) {
        partnerTotal += Number(w.balance) || 0
        partnerCount += 1
      }

      if (!data || data.length < pageSize) break
    }

    const round2 = (n: number) => Math.round(n * 100) / 100
    const roundBreakdown = (b: RoleBreakdown): RoleBreakdown => ({
      retailer: round2(b.retailer),
      distributor: round2(b.distributor),
      master_distributor: round2(b.master_distributor),
      partner: round2(b.partner),
      total: round2(b.total),
      wallet_count: b.wallet_count,
    })

    return NextResponse.json({
      success: true,
      primary: roundBreakdown(primary),
      aeps: roundBreakdown(aeps),
      partner_api: { total: round2(partnerTotal), wallet_count: partnerCount },
      grand_total: round2(primary.total + aeps.total + partnerTotal),
      generated_at: new Date().toISOString(),
    })
  } catch (e: any) {
    console.error('[cumulative-balances]', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
