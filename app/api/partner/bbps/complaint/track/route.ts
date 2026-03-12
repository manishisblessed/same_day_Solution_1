import { NextRequest, NextResponse } from 'next/server'
import { authenticatePartner, PartnerAuthError } from '@/lib/partner-auth'
import { complaintTracking } from '@/services/bbps'

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

    const { complaint_id, complaint_type } = body
    if (!complaint_id) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'complaint_id is required' } },
        { status: 400 }
      )
    }

    const result = await complaintTracking({
      complaintId: complaint_id,
      complaintType: complaint_type || 'Service',
    })

    return NextResponse.json({
      success: true,
      data: {
        complaintId: result.complaint_id,
        complaintType: result.complaint_type || complaint_type || 'Service',
        status: result.status,
        description: result.description,
        resolution: result.resolution,
      },
    })
  } catch (error: any) {
    console.error('[Partner BBPS Complaint Track] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to track complaint' } },
      { status: 500 }
    )
  }
}
