import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { checkTransactionStatus } from '@/services/shadval-pay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const ALLOWED_ROLES = ['admin', 'finance_executive']

/**
 * GET /api/admin/reversal/shadval-status?reference_id=...
 * Live provider status lookup for a single settlement (read-only, no side effects).
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

    const referenceId = request.nextUrl.searchParams.get('reference_id') || ''
    if (!referenceId) {
      return NextResponse.json({ success: false, error: 'reference_id is required' }, { status: 400 })
    }

    const statusResult = await checkTransactionStatus({ reference_id: referenceId })
    return NextResponse.json({
      success: true,
      provider_status: statusResult?.status || 'UNKNOWN',
      txn_status: statusResult?.data?.txn_status || null,
      status_message: statusResult?.data?.status_message || null,
      utr: statusResult?.data?.utr || null,
      order_id: statusResult?.data?.order_id || null,
      amount: statusResult?.data?.trans_amount ?? null,
      timestamp: statusResult?.data?.timestamp || null,
    })
  } catch (error: any) {
    console.error('[Shadval Status] Error:', error)
    return NextResponse.json({ success: false, error: error?.message || 'Status check failed' }, { status: 500 })
  }
}
