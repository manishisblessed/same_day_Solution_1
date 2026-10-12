import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { pay2newCheckStatus } from '@/services/pay2new'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const ALLOWED_ROLES = ['admin', 'finance_executive']

/**
 * GET /api/admin/pay2new/status?request_id=SDS...
 * Live Pay2New status for a single BBPS-2 txn (read-only). This is the "Check"
 * an admin MUST run before a manual refund — the refund endpoint re-verifies.
 */
export async function GET(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Session expired', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (!ALLOWED_ROLES.includes(admin.role as string)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
    }

    const requestId = request.nextUrl.searchParams.get('request_id') || ''
    if (!requestId) {
      return NextResponse.json({ success: false, error: 'request_id is required' }, { status: 400 })
    }

    const res = await pay2newCheckStatus({ request_id: requestId })
    // Map to the admin decision: can this be manually refunded?
    // refundable  = vendor definitively did NOT charge (FAILED / not-found / reversed)
    // blocked     = vendor SUCCESS (never refund)
    // wait        = still pending / provider unreachable (do not refund yet)
    let decision: 'refundable' | 'blocked' | 'wait'
    if (!res.success) decision = 'wait'
    else if (res.status === 'SUCCESS') decision = 'blocked'
    else if (res.status === 'FAILED' || res.status === 'REFUNDED') decision = 'refundable'
    else decision = 'wait'

    return NextResponse.json({
      success: true,
      request_id: requestId,
      provider_status: res.success ? res.status : 'UNREACHABLE',
      not_found: !!res.notFound,
      order_id: res.order_id || null,
      operator_reference: res.operator_reference || null,
      message: res.error || null,
      decision,
    })
  } catch (error: any) {
    console.error('[Admin Pay2New Status] Error:', error)
    return NextResponse.json({ success: false, error: error?.message || 'Status check failed' }, { status: 500 })
  }
}
