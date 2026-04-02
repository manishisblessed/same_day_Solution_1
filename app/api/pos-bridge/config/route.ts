import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { listConfiguredEzetapSlugs } from '@/lib/ezetap/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/pos-bridge/config
 * Returns merchant slugs that have Ezetap credentials (no secrets).
 */
export async function GET(request: NextRequest) {
  const { user } = await getCurrentUserWithFallback(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (user.role !== 'admin' && user.role !== 'retailer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return NextResponse.json({
    success: true,
    configured_slugs: listConfiguredEzetapSlugs(),
    base_url_configured: !!process.env.EZETAP_API_BASE_URL,
  })
}
