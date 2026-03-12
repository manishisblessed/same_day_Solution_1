import { NextRequest, NextResponse } from 'next/server'
import { authenticatePartner, PartnerAuthError } from '@/lib/partner-auth'
import { transactionStatus } from '@/services/bbps'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function POST(request: NextRequest) {
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
    if (!partner.permissions.includes('bbps') && !partner.permissions.includes('all')) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Missing required permission: bbps' } },
        { status: 403 }
      )
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
        { status: 400 }
      )
    }

    const { transaction_id, track_type } = body
    if (!transaction_id) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'transaction_id is required' } },
        { status: 400 }
      )
    }

    const status = await transactionStatus({
      transactionId: transaction_id,
      trackType: track_type || 'TRANS_REF_ID',
    })

    return NextResponse.json({
      success: true,
      status: 'success',
      message: 'Detail Fetched',
      data: {
        reqId: status.reqId,
        totalAmount: status.totalAmount || status.amount || 0,
        serviceCharge: status.serviceCharge || 0,
        transactionAmount: status.transactionAmount || status.amount || 0,
        referenceNo: status.referenceNo || status.txn_reference_id,
        transaction_id: status.transaction_id,
        status: status.status || 'success',
        remark: status.remark || status.response_reason || 'Successful',
      },
    })
  } catch (error: any) {
    console.error('[Partner BBPS Transaction Status] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch transaction status' } },
      { status: 500 }
    )
  }
}
