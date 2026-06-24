import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { complaintRegistration } from '@/services/bbps'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { transaction_id, complaint_type, description, complaint_disposition } = body
    
    const user = await getCurrentUserFromRequest(request)
    
    if (!user) {
      const response = NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
      return addCorsHeaders(request, response)
    }

    // Only retailers can register complaints
    if (user.role !== 'retailer') {
      const response = NextResponse.json(
        { error: 'Forbidden: Only retailers can access this endpoint' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    if (!transaction_id || !description) {
      const response = NextResponse.json(
        { error: 'transaction_id and description are required' },
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
      .or(`transaction_id.eq.${transaction_id},agent_transaction_id.eq.${transaction_id}`)
      .limit(1)
      .maybeSingle()

    if (!ownedTx) {
      const response = NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      )
      return addCorsHeaders(request, response)
    }

    const complaint = await complaintRegistration({
      transactionId: transaction_id,
      complaintType: complaint_type || 'BBPS', // Default to "BBPS" as per tested API
      description,
      complaintDisposition: complaint_disposition || description, // Use description as default
    })

    if (complaint.success) {
      const ctx = getRequestContext(request)
      logActivityFromContext(ctx, user, {
        activity_type: 'bbps_complaint_register',
        activity_category: 'bbps',
        activity_description: `Registered BBPS complaint for transaction ${transaction_id}`,
      }).catch(() => {})
    }

    // Return response matching tested API format
    const response = NextResponse.json({
      success: complaint.success,
      status: complaint.status || '',
      message: complaint.message || '',
      data: {
        complaintAssigned: complaint.complaint_assigned || '',
        complaintId: complaint.complaint_id || '',
        responseCode: complaint.response_code || '',
        responseReason: complaint.response_reason || '',
        transactionDetails: complaint.transaction_details || '',
      },
      // Also include error fields if complaint failed
      ...(complaint.error_code && {
        error_code: complaint.error_code,
        error_message: complaint.error_message,
      }),
    })
    
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('Error registering complaint:', error)
    const response = NextResponse.json(
      { error: 'Failed to register complaint' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}


