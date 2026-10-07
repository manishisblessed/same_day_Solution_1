import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { isAdminOrFinance } from '@/lib/auth-roles'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { getPlatformRevenueWalletConfig } from '@/lib/wallet/platform-revenue-wallet'
import { sweepPartnerRevenue, PARTNER_REVENUE_SERVICES, type PartnerRevenueService } from '@/lib/commission/partner-revenue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * POST /api/admin/reports/revenue/sync-partners
 * Body: { date_from: 'YYYY-MM-DD', date_to?: 'YYYY-MM-DD', services?: string[], dry_run?: boolean, max_book?: number }
 *
 * Finds successful partner transactions with no company-revenue entry and (unless
 * dry_run, which is the DEFAULT) books them. Idempotent.
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || !isAdminOrFinance(user)) {
      return addCorsHeaders(request, NextResponse.json({ error: 'Admin access required' }, { status: 403 }))
    }
    if (!getPlatformRevenueWalletConfig()) {
      return addCorsHeaders(request, NextResponse.json({ error: 'SUBSCRIPTION_REVENUE_USER_ID is not configured' }, { status: 400 }))
    }

    const body = await request.json().catch(() => ({}))
    const dateFrom = String(body.date_from || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
      return addCorsHeaders(request, NextResponse.json({ error: 'date_from (YYYY-MM-DD) is required' }, { status: 400 }))
    }
    const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date_to || '')) ? String(body.date_to) : null

    const valid = Object.keys(PARTNER_REVENUE_SERVICES)
    const services = Array.isArray(body.services)
      ? (body.services.filter((s: string) => valid.includes(s)) as PartnerRevenueService[])
      : undefined

    const from = new Date(`${dateFrom}T00:00:00+05:30`).toISOString()
    const to = dateTo ? new Date(new Date(`${dateTo}T00:00:00+05:30`).getTime() + 864e5).toISOString() : undefined

    const results = await sweepPartnerRevenue({
      supabase: getSupabaseAdmin(),
      services,
      from,
      to,
      dryRun: body.dry_run !== false,
      maxBook: Math.min(20000, Math.max(1, Number(body.max_book) || 5000)),
    })

    return addCorsHeaders(request, NextResponse.json({ dry_run: body.dry_run !== false, results }))
  } catch (e: any) {
    console.error('[Revenue Sync Partners] Error:', e)
    return addCorsHeaders(request, NextResponse.json({ error: e?.message || 'Sync failed' }, { status: 500 }))
  }
}
