import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { verifyGST, generateOrderId } from '@/services/ekyc'

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
    const { gst } = body

    if (!gst || gst.length < 15) {
      return NextResponse.json(
        { error: 'Valid GST number required (15 characters)' },
        { status: 400 }
      )
    }

    const orderid = generateOrderId('GST')
    const result = await verifyGST(gst.toUpperCase(), orderid)

    if (result.status === 'Failure') {
      return NextResponse.json({
        success: false,
        error: result.message || 'GST verification failed',
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        gstin: result.GSTIN,
        legal_name: result.legal_name_of_business,
        trade_name: result.trade_name_of_business,
        status: result.gst_in_status,
        taxpayer_type: result.taxpayer_type,
        constitution: result.constitution_of_business,
        address: result.principal_place_address,
        center_jurisdiction: result.center_jurisdiction,
        state_jurisdiction: result.state_jurisdiction,
      },
      orderid,
    })
  } catch (error: any) {
    console.error('[KYC Verify GST] Error:', error)
    return NextResponse.json(
      { error: error.message || 'GST verification failed' },
      { status: 500 }
    )
  }
}
