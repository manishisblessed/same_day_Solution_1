import { NextRequest, NextResponse } from 'next/server'
import { authenticatePartner, PartnerAuthError } from '@/lib/partner-auth'
import { getBillersByCategoryAndChannel } from '@/services/bbps'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function POST(request: NextRequest) {
  try {
    let authResult
    try {
      authResult = await authenticatePartner(request)
    } catch (error) {
      const e = error as PartnerAuthError
      return NextResponse.json(
        { success: false, error: { code: e.code, message: e.message } },
        { status: e.status }
      )
    }

    const { partner } = authResult
    if (!partner.permissions.includes('bbps') && !partner.permissions.includes('all')) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Missing required permission: bbps' } },
        { status: 403 }
      )
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
        { status: 400 }
      )
    }

    const { category, paymentChannelName1, paymentChannelName2, paymentChannelName3 } = body

    if (!category) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'category is required' } },
        { status: 400 }
      )
    }

    const billers = await getBillersByCategoryAndChannel({
      fieldValue: category,
      paymentChannelName1: paymentChannelName1 || 'INT',
      paymentChannelName2: paymentChannelName2 || 'AGT',
      paymentChannelName3: paymentChannelName3 || '',
    })

    return NextResponse.json({
      success: true,
      data: billers,
      count: billers.length,
    })
  } catch (error: any) {
    console.error('[Partner BBPS Billers] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch billers' } },
      { status: 500 }
    )
  }
}
