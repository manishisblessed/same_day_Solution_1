import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { trackComplaint } from '@/lib/bbps/service'
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

    const complaint = await trackComplaint(
      complaint_id,
      complaint_type || 'Service'
    )

    const response = NextResponse.json({
      success: true,
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






