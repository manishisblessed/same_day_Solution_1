/**
 * GET /api/admin/reversal/knteer-status?partner_trans_id=...
 * Check live status at Knteer for a specific transaction.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { checkKnteerStatus } from '@/services/knteer-payout'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['admin', 'finance_executive']

export async function GET(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin || !ALLOWED_ROLES.includes(admin.role as string)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
    }

    const partnerTransId = request.nextUrl.searchParams.get('partner_trans_id') || ''
    if (!partnerTransId) {
      return NextResponse.json({ success: false, error: 'partner_trans_id required' }, { status: 400 })
    }

    const result = await checkKnteerStatus(partnerTransId)
    return NextResponse.json({ success: true, provider: result })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
