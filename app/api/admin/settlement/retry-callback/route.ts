import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { retrySettlementCallback } from '@/lib/settlement-callback'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * POST /api/admin/settlement/retry-callback
 * Body: { reference_id: string }
 *
 * Re-sends the settlement callback to the partner's webhook_url.
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

    const body = await request.json()
    const { reference_id } = body

    if (!reference_id) {
      return addCorsHeaders(
        request,
        NextResponse.json({ success: false, error: 'reference_id is required' }, { status: 400 })
      )
    }

    const result = await retrySettlementCallback(reference_id)

    const status = result.sent ? 200 : 400
    const response = NextResponse.json({
      success: result.sent,
      message: result.sent
        ? `Callback delivered (HTTP ${result.httpStatus})`
        : `Callback failed: ${result.error}`,
      transaction: result.transaction || null,
    }, { status })

    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[Admin RetryCallback] Error:', error)
    return addCorsHeaders(
      request,
      NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
    )
  }
}
