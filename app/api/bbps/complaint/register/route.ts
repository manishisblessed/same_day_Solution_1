import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { complaintRegistration } from '@/services/bbps'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function POST(request: NextRequest) {
  try {
    // Get current user (server-side)
    const user = await getCurrentUserServer()
    if (!user) {
      const response = NextResponse.json(
        { error: 'Unauthorized' },
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
      complaintType: complaint_type || 'Transaction',
      description,
      complaintDisposition: complaint_disposition || 'Amount deducted multiple times',
    })

    const response = NextResponse.json({
      success: complaint.success,
      complaint_id: complaint.complaint_id,
      transaction_id: complaint.transaction_id,
      status: complaint.status,
      message: complaint.message,
      error_code: complaint.error_code,
      error_message: complaint.error_message,
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


