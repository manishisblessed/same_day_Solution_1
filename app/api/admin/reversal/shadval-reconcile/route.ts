import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { isAdminOrFinance } from '@/lib/auth-roles'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { runShadvalReconciliation } from '@/lib/settlement-2/reconcile-shadval-report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/reversal/shadval-reconcile
 *
 * On-demand Settlement-2 (Shadval) reconciliation. Re-checks every
 * FAILED+refunded transaction in the window against the provider and reports
 * any confirmed double-money (payout SUCCEEDED but wallet was refunded),
 * raising SETTLEMENT2_DOUBLE_MONEY alerts. READ-ONLY on wallets.
 *
 * Body (optional): { days?: number, limit?: number, raiseAlerts?: boolean }
 * Auth: admin or finance. Must run from a Shadval-whitelisted host (prod EC2).
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    if (!isAdminOrFinance(user)) {
      return NextResponse.json({ error: 'Admin or finance access required' }, { status: 403 })
    }

    let body: any = {}
    try { body = await request.json() } catch { body = {} }

    const days = Math.min(Math.max(parseInt(String(body.days ?? 7), 10) || 7, 1), 90)
    const limit = Math.min(Math.max(parseInt(String(body.limit ?? 300), 10) || 300, 1), 1000)
    const raiseAlerts = body.raiseAlerts !== false

    const supabase = getSupabaseAdmin()
    const outcome = await runShadvalReconciliation(supabase, { days, limit, concurrency: 5, raiseAlerts })

    return NextResponse.json({
      success: true,
      window_days: days,
      checked: outcome.checked,
      refund_ok: outcome.refundOk,
      unverified: outcome.unverified,
      double_money_count: outcome.doubleMoney.length,
      total_loss: outcome.totalLoss,
      double_money: outcome.doubleMoney,
    })
  } catch (err: any) {
    console.error('[Shadval-Reconcile] Error:', err?.message || err)
    return NextResponse.json({ success: false, error: err?.message || 'Internal error' }, { status: 500 })
  }
}
