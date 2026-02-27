import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { createClient } from '@supabase/supabase-js'
import { complaintRegistration } from '@/services/bbps'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { transaction_id, complaint_type, description, complaint_disposition } = body
    
    // Try cookie-based auth first
    let user = await getCurrentUserFromRequest(request)
    
    // If cookie auth fails, try to verify user from request body (fallback)
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
      console.error('[BBPS Complaint Register] No authenticated user found')
      const response = NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
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


