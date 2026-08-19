import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { resolvePendingPartnerSettlements } from '@/lib/settlement-2/resolve-pending-partner-settlements'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const STALE_MINUTES = 1
const HARD_TIMEOUT_MINUTES = 60

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

/**
 * POST /api/partner/settlement/check-pending
 *
 * Resolves stuck PENDING settlement transactions:
 * - With reference_id: queries Shadval Pay status API
 * - Older than HARD_TIMEOUT_MINUTES without resolution: auto-fails + refunds
 * - Fires partner callback on status change
 *
 * The actual reconciliation logic lives in `resolvePendingPartnerSettlements`
 * (shared with the partner-settlement-check cron) so the exactly-once refund /
 * anti-double-credit behaviour is identical on the manual and automatic paths.
 *
 * Auth: x-cron-secret header for cron, or admin session
 */
export async function POST(request: NextRequest) {
  try {
    const cronSecret = request.headers.get('x-cron-secret')
    const isAuthorizedCron = !!(cronSecret && cronSecret === process.env.CRON_SECRET)

    if (!isAuthorizedCron) {
      const { user } = await getCurrentUserWithFallback(request)
      if (!user || !['admin', 'finance_executive'].includes(user.role as string)) {
        return NextResponse.json(
          { success: false, error: 'Admin or cron authentication required' },
          { status: 401 }
        )
      }
    }

    const supabase = getSupabase()

    let outcome
    try {
      outcome = await resolvePendingPartnerSettlements(supabase, {
        staleMinutes: STALE_MINUTES,
        hardTimeoutMinutes: HARD_TIMEOUT_MINUTES,
        limit: 50,
      })
    } catch (err: any) {
      console.error('[Settlement Check-Pending] Resolve error:', err?.message || err)
      return NextResponse.json({ success: false, error: 'Failed to fetch pending transactions' }, { status: 500 })
    }

    if (outcome.checked === 0) {
      return NextResponse.json({ success: true, message: 'No pending settlement transactions', checked: 0, resolved: 0, refunded: 0 })
    }

    console.log(`[Settlement Check-Pending] Done: checked=${outcome.checked} resolved=${outcome.resolved} refunded=${outcome.refunded} stillPending=${outcome.stillPending}`)

    return NextResponse.json({
      success: true,
      checked: outcome.checked,
      resolved: outcome.resolved,
      refunded: outcome.refunded,
      still_pending: outcome.stillPending,
      results: isAuthorizedCron ? outcome.results : undefined,
    })
  } catch (error: any) {
    console.error('[Settlement Check-Pending] Error:', error)
    return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
  }
}
