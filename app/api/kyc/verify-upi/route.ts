import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { verifyUPI, generateOrderId } from '@/services/ekyc'

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
    const { upi } = body

    if (!upi || !upi.includes('@')) {
      return NextResponse.json(
        { error: 'Valid UPI ID required (e.g., name@upi)' },
        { status: 400 }
      )
    }

    const orderid = generateOrderId('UPI')
    const result = await verifyUPI(upi, orderid)

    if (result.status === 'Failure') {
      return NextResponse.json({
        success: false,
        error: result.message || 'UPI verification failed',
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        nameAtBank: result.nameAtBank,
        accountExists: result.accountExists,
      },
      orderid,
    })
  } catch (error: any) {
    console.error('[KYC Verify UPI] Error:', error)
    return NextResponse.json(
      { error: error.message || 'UPI verification failed' },
      { status: 500 }
    )
  }
}
