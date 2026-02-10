import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { complaintRegistration } from '@/services/bbps'
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
    console.log('[BBPS Complaint Register] Auth:', method, '|', user?.email || 'none')
    
    if (!user) {
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

    const body = await request.json()
    const { transaction_id, complaint_type, description, complaint_disposition } = body

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


