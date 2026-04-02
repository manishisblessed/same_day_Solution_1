import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { ezetapStatus } from '@/lib/ezetap/client'
import { getEzetapCredentials } from '@/lib/ezetap/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/pos-bridge/status
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (user.role !== 'admin' && user.role !== 'retailer') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const merchant_slug = String(body.merchant_slug || '').toLowerCase().trim()
    const origP2pRequestId = String(body.origP2pRequestId || '').trim()

    if (!merchant_slug || !origP2pRequestId) {
      return NextResponse.json(
        { error: 'merchant_slug and origP2pRequestId are required' },
        { status: 400 }
      )
    }

    try {
      getEzetapCredentials(merchant_slug)
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'Credentials not configured' }, { status: 400 })
    }

    const result = await ezetapStatus(merchant_slug, origP2pRequestId)
    return NextResponse.json({
      success: result.ok,
      status: result.status,
      data: result.data,
    })
  } catch (e: any) {
    console.error('[pos-bridge/status]', e)
    return NextResponse.json({ error: e?.message || 'Status request failed' }, { status: 500 })
  }
}
