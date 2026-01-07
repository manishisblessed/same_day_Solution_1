import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { transactionStatus } from '@/services/bbps'

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

    // Only retailers can check transaction status
    if (user.role !== 'retailer') {
      return NextResponse.json(
        { error: 'Forbidden: Only retailers can access this endpoint' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { transaction_id, track_type } = body

    if (!transaction_id) {
      return NextResponse.json(
        { error: 'transaction_id is required' },
        { status: 400 }
      )
    }

    const status = await transactionStatus({
      transactionId: transaction_id,
      trackType: track_type || 'TRANS_REF_ID',
    })

    return NextResponse.json({
      success: true,
      status,
    })
  } catch (error: any) {
    console.error('Error fetching transaction status:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch transaction status' },
      { status: 500 }
    )
  }
}


