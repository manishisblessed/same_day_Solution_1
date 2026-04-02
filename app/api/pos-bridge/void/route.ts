import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { ezetapVoid } from '@/lib/ezetap/client'
import { getEzetapCredentials } from '@/lib/ezetap/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/pos-bridge/void
 * Admin only — Ezetap 2.0 void API.
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
    const txnId = String(body.txnId || '').trim()

    if (!merchant_slug || !txnId) {
      return NextResponse.json(
        { error: 'merchant_slug and txnId are required' },
        { status: 400 }
      )
    }

    try {
      getEzetapCredentials(merchant_slug)
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'Credentials not configured' }, { status: 400 })
    }

    const result = await ezetapVoid(merchant_slug, txnId)
    return NextResponse.json({
      success: result.ok,
      status: result.status,
      data: result.data,
    })
  } catch (e: any) {
    console.error('[pos-bridge/void]', e)
    return NextResponse.json({ error: e?.message || 'Void request failed' }, { status: 500 })
  }
}
