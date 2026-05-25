import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { verifyPAN, generateOrderId } from '@/services/ekyc'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const allowedRoles = ['admin', 'master_distributor', 'distributor', 'retailer']
    if (!allowedRoles.includes(user.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const body = await request.json()
    const { pan } = body

    if (!pan || !/^[A-Z]{5}\d{4}[A-Z]$/.test(pan.toUpperCase())) {
      return NextResponse.json(
        { error: 'Valid PAN number required (e.g., ABCDE1234F)' },
        { status: 400 }
      )
    }

    const orderid = generateOrderId('PAN')
    const result = await verifyPAN(pan.toUpperCase(), orderid)

    if (result.status === 'Failure') {
      return NextResponse.json({
        success: false,
        error: result.message || 'PAN verification failed',
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        pan: result.pan,
        registered_name: result.registered_name,
        type: result.type,
      },
      orderid,
    })
  } catch (error: any) {
    console.error('[KYC Verify PAN] Error:', error)
    return NextResponse.json(
      { error: error.message || 'PAN verification failed' },
      { status: 500 }
    )
  }
}
