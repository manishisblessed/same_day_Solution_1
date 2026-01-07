import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { fetchBillerInfo } from '@/lib/bbps/service'

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

    // Only retailers can fetch biller info
    if (user.role !== 'retailer') {
      return NextResponse.json(
        { error: 'Forbidden: Only retailers can access this endpoint' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { biller_id } = body

    if (!biller_id) {
      return NextResponse.json(
        { error: 'biller_id is required' },
        { status: 400 }
      )
    }

    const billerInfo = await fetchBillerInfo(biller_id)

    return NextResponse.json({
      success: true,
      biller_info: billerInfo,
    })
  } catch (error: any) {
    console.error('Error fetching biller info:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch biller info' },
      { status: 500 }
    )
  }
}



