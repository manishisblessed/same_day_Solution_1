import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { transactionStatus } from '@/services/bbps'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function sanitizeFilterValue(value: string): string {
  return value.replace(/[,()\\*%]/g, '').trim()
}

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { transaction_id, track_type } = body
    
    const user = await getCurrentUserFromRequest(request)
    
    if (!user) {
      const response = NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
      return addCorsHeaders(request, response)
    }

    // Only retailers can check transaction status
    if (!['retailer', 'partner'].includes(user.role)) {
      const response = NextResponse.json(
        { error: 'Forbidden: Only retailers can access this endpoint' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    if (!transaction_id) {
      const response = NextResponse.json(
        { error: 'transaction_id is required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Ownership check: the transaction must belong to the calling retailer.
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )
    const { data: ownedTx } = await supabaseAdmin
      .from('bbps_transactions')
      .select('id')
      .eq('retailer_id', user.partner_id)
      .or(`transaction_id.eq.${sanitizeFilterValue(transaction_id)},agent_transaction_id.eq.${sanitizeFilterValue(transaction_id)}`)
      .limit(1)
      .maybeSingle()

    if (!ownedTx) {
      const response = NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      )
      return addCorsHeaders(request, response)
    }

    const status = await transactionStatus({
      transactionId: transaction_id,
      trackType: track_type || 'TRANS_REF_ID',
    })

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, {
      activity_type: 'bbps_transaction_status',
      activity_category: 'bbps',
    }).catch(() => {})

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


