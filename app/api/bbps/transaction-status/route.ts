import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { transactionStatus } from '@/services/bbps'
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

    // Only retailers can check transaction status
    if (user.role !== 'retailer') {
      const response = NextResponse.json(
        { error: 'Forbidden: Only retailers can access this endpoint' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const body = await request.json()
    const { transaction_id, track_type } = body

    if (!transaction_id) {
      const response = NextResponse.json(
        { error: 'transaction_id is required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const status = await transactionStatus({
      transactionId: transaction_id,
      trackType: track_type || 'TRANS_REF_ID',
    })

    const response = NextResponse.json({
      success: true,
      status,
    })
    
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('Error fetching transaction status:', error)
    const response = NextResponse.json(
      { error: 'Failed to fetch transaction status' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}


