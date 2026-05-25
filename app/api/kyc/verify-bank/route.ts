import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { verifyBankPennyLess, generateOrderId } from '@/services/ekyc'

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
    const { account_number, ifsc } = body

    if (!account_number || !/^\d{9,18}$/.test(account_number.replace(/\s/g, ''))) {
      return NextResponse.json(
        { error: 'Valid account number required (9-18 digits)' },
        { status: 400 }
      )
    }

    const normalizedIfsc = (ifsc || '').replace(/\s/g, '').toUpperCase()
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalizedIfsc)) {
      return NextResponse.json(
        { error: 'Valid IFSC code required (e.g., SBIN0001266)' },
        { status: 400 }
      )
    }

    const orderid = generateOrderId('BANK')
    const result = await verifyBankPennyLess(
      account_number.replace(/\s/g, ''),
      normalizedIfsc,
      orderid
    )

    if (result.status === 'Failure') {
      return NextResponse.json({
        success: false,
        error: result.message || 'Bank verification failed',
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        nameAtBank: result.nameAtBank,
        utr: result.utr,
        account_number: result['Account Number'],
        ifsc_code: result['Ifsc Code'],
      },
      orderid,
    })
  } catch (error: any) {
    console.error('[KYC Verify Bank] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Bank verification failed' },
      { status: 500 }
    )
  }
}
