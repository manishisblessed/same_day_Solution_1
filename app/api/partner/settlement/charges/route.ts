import { NextRequest, NextResponse } from 'next/server'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

/**
 * GET /api/partner/settlement/charges?amount=1000&mode=IMPS
 * Get settlement charges for a given amount and mode.
 * For partner APIs, settlement charges are 0 (direct wallet debit).
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

    const { searchParams } = new URL(request.url)
    const amount = parseFloat(searchParams.get('amount') || '0')
    const mode = searchParams.get('mode') || 'IMPS'

    if (amount <= 0) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Valid amount is required' } },
        { status: 400 }
      )
    }

    const validModes = ['IMPS', 'NEFT', 'RTGS']
    if (!validModes.includes(mode)) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid mode. Must be IMPS, NEFT, or RTGS' } },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      amount,
      mode,
      charges: 0,
      total_debit: amount,
      message: 'No additional charges for partner settlement transfers',
    })
  } catch (error: any) {
    console.error('[Partner Settlement Charges] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
