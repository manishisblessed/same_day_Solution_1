import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { verifyVoterCard, generateOrderId } from '@/services/ekyc'

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
    const { epic_number } = body

    if (!epic_number) {
      return NextResponse.json(
        { error: 'Voter card (EPIC) number required' },
        { status: 400 }
      )
    }

    const orderid = generateOrderId('VOTER')
    const result = await verifyVoterCard(epic_number.toUpperCase(), orderid)

    if (result.status === 'Failure') {
      return NextResponse.json({
        success: false,
        error: result.message || 'Voter card verification failed',
      })
    }

    return NextResponse.json({
      success: true,
      data: result.data,
      orderid,
    })
  } catch (error: any) {
    console.error('[KYC Verify Voter] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Voter card verification failed' },
      { status: 500 }
    )
  }
}
