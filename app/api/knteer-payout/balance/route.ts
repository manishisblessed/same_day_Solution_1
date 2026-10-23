import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { normalizeMasterPartner } from '@/lib/partner-access'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getKnteerBalance } from '@/services/knteer-payout'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const res = handleCorsPreflight(request)
  return res || new NextResponse(null, { status: 204 })
}

/** GET /api/knteer-payout/balance — Knteer provider wallet balance (admin/internal use) */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    normalizeMasterPartner(user)

    if (!user || !['admin', 'partner', 'master_distributor', 'distributor', 'retailer'].includes(user.role || '')) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 }))
    }

    const result = await getKnteerBalance()
    const response = NextResponse.json(result, { status: result.success ? 200 : 502 })
    return addCorsHeaders(request, response)
  } catch (err: any) {
    console.error('[Knteer Balance Route] Error:', err)
    return addCorsHeaders(request, NextResponse.json({ success: false, error: err.message }, { status: 500 }))
  }
}
