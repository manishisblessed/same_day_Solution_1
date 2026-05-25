import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { verifyPassport, generateOrderId } from '@/services/ekyc'

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
    const { file_number, dob } = body

    if (!file_number) {
      return NextResponse.json(
        { error: 'Passport file number required' },
        { status: 400 }
      )
    }
    if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      return NextResponse.json(
        { error: 'Date of birth required in YYYY-MM-DD format' },
        { status: 400 }
      )
    }

    const orderid = generateOrderId('PASSPORT')
    const result = await verifyPassport(file_number.toUpperCase(), dob, orderid)

    if (result.status === 'Failure') {
      return NextResponse.json({
        success: false,
        error: result.message || 'Passport verification failed',
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        file_number: result.file_number,
        name: result.name,
        dob: result.dob,
        application_type: result.application_type,
        application_received_date: result.application_received_date,
      },
      orderid,
    })
  } catch (error: any) {
    console.error('[KYC Verify Passport] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Passport verification failed' },
      { status: 500 }
    )
  }
}
