import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { replayPosCallback } from '@/lib/partner-webhook/retry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * POST /api/admin/pos/replay-callback
 * Body: { txn_id: string }
 *
 * Re-sends the forward `pos.transaction` callback to the owning partner's
 * webhook endpoint(s), rebuilding the canonical payload from the stored
 * transaction. Admin-only.
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    const role = user?.role as string | undefined
    if (role !== 'admin' && role !== 'super_admin') {
      return addCorsHeaders(
        request,
        NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 })
      )
    }

    const body = await request.json().catch(() => ({}))
    const txnId = body?.txn_id

    if (!txnId || typeof txnId !== 'string') {
      return addCorsHeaders(
        request,
        NextResponse.json({ success: false, error: 'txn_id is required' }, { status: 400 })
      )
    }

    const result = await replayPosCallback(txnId)
    const status = result.sent ? 200 : 400

    return addCorsHeaders(
      request,
      NextResponse.json(
        {
          success: result.sent,
          message: result.sent
            ? 'Callback delivered'
            : `Callback not delivered: ${result.error || 'all endpoints failed'}`,
          partner_id: result.partnerId,
          deliveries: result.results.map((r) => ({
            url: r.url,
            success: r.success,
            status_code: r.statusCode,
            error: r.error,
          })),
        },
        { status }
      )
    )
  } catch (error: any) {
    console.error('[Admin POS ReplayCallback] Error:', error)
    return addCorsHeaders(
      request,
      NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    )
  }
}
