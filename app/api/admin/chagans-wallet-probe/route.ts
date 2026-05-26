import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getBBPSProvider } from '@/services/bbps/config'
import { probeChagansWalletPaths } from '@/services/bbps/getChagansWalletBalance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * GET /api/admin/chagans-wallet-probe
 * Admin-only: tries Chagans wallet balance route candidates from EC2 (whitelisted IP).
 */
export async function GET(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)

    if (!admin) {
      const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      return addCorsHeaders(request, response)
    }

    if (admin.role !== 'admin') {
      const response = NextResponse.json({ error: 'Admin access required' }, { status: 403 })
      return addCorsHeaders(request, response)
    }

    if (getBBPSProvider() !== 'chagans') {
      const response = NextResponse.json(
        { error: 'BBPS_PROVIDER is not chagans' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const results = await probeChagansWalletPaths()
    const working = results.find((r) => r.ok)

    const response = NextResponse.json({
      success: Boolean(working),
      working_path: working ? `${working.method} ${working.path}` : null,
      balance: working?.balance ?? null,
      results,
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    const response = NextResponse.json(
      { success: false, error: error.message || 'Probe failed' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
