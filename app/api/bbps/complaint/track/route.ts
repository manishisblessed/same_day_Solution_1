import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { complaintTracking } from '@/services/bbps'
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
    console.log('[BBPS Complaint Track] Auth:', method, '|', user?.email || 'none')
    
    if (!user) {
      const response = NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
      return addCorsHeaders(request, response)
    }

    // Only retailers can track complaints
    if (user.role !== 'retailer') {
      const response = NextResponse.json(
        { error: 'Forbidden: Only retailers can access this endpoint' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const body = await request.json()
    const { complaint_id, complaint_type } = body

    if (!complaint_id) {
      const response = NextResponse.json(
        { error: 'complaint_id is required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const complaint = await complaintTracking({
      complaintId: complaint_id,
      complaintType: complaint_type || 'Service',
    })

    // Return response matching tested API format
    // Note: The response format may vary, but we'll return the complaint tracking data
    const response = NextResponse.json({
      success: true,
      status: complaint.status || 'success',
      message: 'Complaint tracking details fetched',
      data: {
        complaintId: complaint.complaint_id,
        complaintType: complaint.complaint_type || complaint_type || 'Service',
        status: complaint.status,
        description: complaint.description,
        resolution: complaint.resolution,
      },
      // Also include full complaint object for backward compatibility
      complaint,
    })
    
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('Error tracking complaint:', error)
    const response = NextResponse.json(
      { error: 'Failed to track complaint' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}






