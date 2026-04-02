import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { ezetapRefund } from '@/lib/ezetap/client'
import { getEzetapCredentials } from '@/lib/ezetap/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/pos-bridge/refund
 * Admin only — Ezetap 2.0 refund API.
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }

    const body = await request.json()
    const merchant_slug = String(body.merchant_slug || '').toLowerCase().trim()
    const amount = body.amount
    const externalRefNumber = String(body.externalRefNumber || '').trim()

    if (!merchant_slug || amount == null || amount === '' || !externalRefNumber) {
      return NextResponse.json(
        { error: 'merchant_slug, amount, and externalRefNumber are required' },
        { status: 400 }
      )
    }

    try {
      getEzetapCredentials(merchant_slug)
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'Credentials not configured' }, { status: 400 })
    }

    const result = await ezetapRefund({
      merchant_slug,
      amount,
      externalRefNumber,
      externalRefNumber2: body.externalRefNumber2,
    })

    return NextResponse.json({
      success: result.ok,
      status: result.status,
      data: result.data,
    })
  } catch (e: any) {
    console.error('[pos-bridge/refund]', e)
    return NextResponse.json({ error: e?.message || 'Refund request failed' }, { status: 500 })
  }
}
