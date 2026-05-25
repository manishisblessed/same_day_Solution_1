import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { checkBalance } from '@/services/ekyc'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
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

    const result = await checkBalance()

    if (result.status === 'Failure') {
      return NextResponse.json({
        success: false,
        error: result.message || 'Failed to fetch balance',
      })
    }

    return NextResponse.json({
      success: true,
      balance: parseFloat(result.balance || '0'),
      raw_balance: result.balance,
    })
  } catch (error: any) {
    console.error('[eKYC Hub Balance] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch eKYC Hub balance' },
      { status: 500 }
    )
  }
}
