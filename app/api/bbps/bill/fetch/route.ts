import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { fetchBill } from '@/services/bbps'

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

    // Only retailers can fetch bills
    if (user.role !== 'retailer') {
      return NextResponse.json(
        { error: 'Forbidden: Only retailers can access this endpoint' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { biller_id, consumer_number, additional_params, input_params } = body

    if (!biller_id || !consumer_number) {
      return NextResponse.json(
        { error: 'biller_id and consumer_number are required' },
        { status: 400 }
      )
    }

    // Support both input_params (array format) and additional_params (object format)
    const params = input_params || additional_params || {}
    
    // Convert params to inputParams array format if needed
    let inputParams: Array<{ paramName: string; paramValue: string | number }> | undefined
    if (Array.isArray(params)) {
      inputParams = params
    } else if (typeof params === 'object' && params !== null) {
      inputParams = Object.entries(params).map(([key, value]) => ({
        paramName: key,
        paramValue: value as string | number,
      }))
    }

    const billDetails = await fetchBill({
      billerId: biller_id,
      consumerNumber: consumer_number,
      inputParams,
    })

    return NextResponse.json({
      success: true,
      bill: billDetails,
    })
  } catch (error: any) {
    console.error('Error fetching bill details:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch bill details' },
      { status: 500 }
    )
  }
}

