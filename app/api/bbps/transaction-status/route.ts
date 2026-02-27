import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { createClient } from '@supabase/supabase-js'
import { transactionStatus } from '@/services/bbps'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { transaction_id, track_type } = body
    
    // Try cookie-based auth first
    let user = await getCurrentUserFromRequest(request)
    
    // If cookie auth fails, try to verify user from request body (fallback)
    // This is needed because Supabase cookie-based auth may not work reliably
    if (!user && body.user_id) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
      const supabase = createClient(supabaseUrl, supabaseServiceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
      
      const { data: retailer } = await supabase
        .from('retailers')
        .select('partner_id, name, email')
        .eq('partner_id', body.user_id)
        .maybeSingle()
      
      if (retailer) {
        user = {
          id: body.user_id,
          email: retailer.email,
          role: 'retailer',
          partner_id: retailer.partner_id,
          name: retailer.name,
        }
        // Fallback auth active (cross-origin — no Supabase cookies)
      }
    }
    
    if (!user) {
      console.error('[BBPS Transaction Status] No authenticated user found')
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


