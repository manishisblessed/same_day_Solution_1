import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { verifyDrivingLicense, generateOrderId } from '@/services/ekyc'

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

    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { dl_number, dob } = body

    if (!dl_number) {
      return NextResponse.json(
        { error: 'Driving license number required' },
        { status: 400 }
      )
    }
    if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      return NextResponse.json(
        { error: 'Date of birth required in YYYY-MM-DD format' },
        { status: 400 }
      )
    }

    const orderid = generateOrderId('DL')
    const result = await verifyDrivingLicense(dl_number, dob, orderid)

    if (result.status === 'Failure') {
      return NextResponse.json({
        success: false,
        error: result.message || 'DL verification failed',
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        dl_number: result.dl_number,
        name: result.name,
        dob: result.dob,
        dl_status: result.dl_status,
        class_of_vehicle: result.class_of_vehicle,
        date_of_issue: result.date_of_issue,
        non_transport_from: result.non_transport_from,
        non_transport_to: result.non_transport_to,
        father_or_husband_name: result.father_or_husband_name,
        address: result.complete_address,
      },
      orderid,
    })
  } catch (error: any) {
    console.error('[KYC Verify DL] Error:', error)
    return NextResponse.json(
      { error: error.message || 'DL verification failed' },
      { status: 500 }
    )
  }
}
