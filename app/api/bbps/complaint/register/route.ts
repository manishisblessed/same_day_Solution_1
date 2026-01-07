import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { complaintRegistration } from '@/services/bbps'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    // Get current user (server-side)
    const user = await getCurrentUserServer()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Only retailers can register complaints
    if (user.role !== 'retailer') {
      return NextResponse.json(
        { error: 'Forbidden: Only retailers can access this endpoint' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { transaction_id, complaint_type, description, complaint_disposition } = body

    if (!transaction_id || !description) {
      return NextResponse.json(
        { error: 'transaction_id and description are required' },
        { status: 400 }
      )
    }

    const complaint = await complaintRegistration({
      transactionId: transaction_id,
      complaintType: complaint_type || 'Transaction',
      description,
      complaintDisposition: complaint_disposition || 'Amount deducted multiple times',
    })

    return NextResponse.json({
      success: complaint.success,
      complaint_id: complaint.complaint_id,
      transaction_id: complaint.transaction_id,
      status: complaint.status,
      message: complaint.message,
      error_code: complaint.error_code,
      error_message: complaint.error_message,
    })
  } catch (error: any) {
    console.error('Error registering complaint:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to register complaint' },
      { status: 500 }
    )
  }
}


