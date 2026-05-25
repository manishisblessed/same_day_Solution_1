import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { verifyCIN, generateOrderId } from '@/services/ekyc'

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
    const { cin } = body

    if (!cin || cin.length < 10) {
      return NextResponse.json(
        { error: 'Valid CIN number required' },
        { status: 400 }
      )
    }

    const orderid = generateOrderId('CIN')
    const result = await verifyCIN(cin.toUpperCase(), orderid)

    if (result.status === 'Failure') {
      return NextResponse.json({
        success: false,
        error: result.message || 'CIN verification failed',
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        company_name: result.data?.company_name || result.company_name,
        cin: result.data?.cin,
        cin_status: result.data?.cin_status,
        registration_number: result.data?.registration_number,
        incorporation_date: result.data?.incorporation_date,
        email: result.data?.email,
        director_details: result.data?.director_details,
      },
      orderid,
    })
  } catch (error: any) {
    console.error('[KYC Verify CIN] Error:', error)
    return NextResponse.json(
      { error: error.message || 'CIN verification failed' },
      { status: 500 }
    )
  }
}
