import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { trackComplaint } from '@/lib/bbps/service'

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

    // Only retailers can track complaints
    if (user.role !== 'retailer') {
      return NextResponse.json(
        { error: 'Forbidden: Only retailers can access this endpoint' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { complaint_id, complaint_type } = body

    if (!complaint_id) {
      return NextResponse.json(
        { error: 'complaint_id is required' },
        { status: 400 }
      )
    }

    const complaint = await trackComplaint(
      complaint_id,
      complaint_type || 'Service'
    )

    return NextResponse.json({
      success: true,
      complaint,
    })
  } catch (error: any) {
    console.error('Error tracking complaint:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to track complaint' },
      { status: 500 }
    )
  }
}



