import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { transactionStatus } from '@/services/bbps'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function POST(request: NextRequest) {
  try {
    // Get current user with fallback
    const { user, method } = await getCurrentUserWithFallback(request)
    console.log('[BBPS Transaction Status] Auth:', method, '|', user?.email || 'none')
    
    if (!user) {
      const response = NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
      return addCorsHeaders(request, response)
    }

    // Only retailers can check transaction status
    if (user.role !== 'retailer') {
      const response = NextResponse.json(
        { error: 'Forbidden: Only retailers can access this endpoint' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const body = await request.json()
    const { transaction_id, track_type } = body

    if (!transaction_id) {
      const response = NextResponse.json(
        { error: 'transaction_id is required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const status = await transactionStatus({
      transactionId: transaction_id,
      trackType: track_type || 'TRANS_REF_ID',
    })

    // Return response matching tested API format
    const response = NextResponse.json({
      success: true,
      status: 'success',
      message: 'Detail Fetched',
      data: {
        reqId: status.reqId || body.reqId,
        totalAmount: status.totalAmount || status.amount || 0,
        serviceCharge: status.serviceCharge || 0,
        transactionAmount: status.transactionAmount || status.amount || 0,
        referenceNo: status.referenceNo || status.txn_reference_id,
        transaction_id: status.transaction_id,
        status: status.status || 'success',
        remark: status.remark || status.response_reason || 'Successful',
        compalainRegisterDes: status.compalainRegisterDes || {},
        compalainRegisterStatus: status.compalainRegisterStatus || false,
      },
    })
    
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('Error fetching transaction status:', error)
    const response = NextResponse.json(
      { error: 'Failed to fetch transaction status' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}


