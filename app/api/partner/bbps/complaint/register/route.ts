import { NextRequest, NextResponse } from 'next/server'
import { authenticatePartner, PartnerAuthError } from '@/lib/partner-auth'
import { complaintRegistration } from '@/services/bbps'

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

    const { transaction_id, complaint_type, description, complaint_disposition } = body
    if (!transaction_id || !description) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'transaction_id and description are required' } },
        { status: 400 }
      )
    }

    const complaint = await complaintRegistration({
      transactionId: transaction_id,
      complaintType: complaint_type || 'BBPS',
      description,
      complaintDisposition: complaint_disposition || description,
    })

    return NextResponse.json({
      success: complaint.success,
      data: {
        complaintAssigned: complaint.complaint_assigned || '',
        complaintId: complaint.complaint_id || '',
        responseCode: complaint.response_code || '',
        responseReason: complaint.response_reason || '',
      },
    })
  } catch (error: any) {
    console.error('[Partner BBPS Complaint Register] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to register complaint' } },
      { status: 500 }
    )
  }
}
