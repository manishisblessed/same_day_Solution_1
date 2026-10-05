import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { isAdminOrFinance } from '@/lib/auth-roles'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { getPlatformRevenueWalletConfig } from '@/lib/wallet/platform-revenue-wallet'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/** Services this report understands. "bbps" and "pay2new" are both BBPS rails. */
const KNOWN_SERVICES = ['bbps', 'pay2new', 'shadval_settlement'] as const
type KnownService = (typeof KNOWN_SERVICES)[number]

/**
 * GET /api/admin/reports/revenue
 *
 * Per-transaction company revenue for BBPS / pay2new / Settlement-2 (account
 * transfer), sourced from the platform revenue wallet ledger
 * (fund_category='revenue'). Each COMPANY_REVENUE credit is the revenue earned on
 * one transaction (= customer charge − ex-GST vendor cost, net of downline
 * commissions); revenue-category debits are reversals.
 *
 * Query params:
 *   service    all | bbps | pay2new | shadval_settlement   (default all)
 *   date_from  YYYY-MM-DD  (default: 30 days ago)
 *   date_to    YYYY-MM-DD  (default: today)
 *   page, limit (max 100)
 *   q          search reference_id / description (ilike)
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || !isAdminOrFinance(user)) {
      return addCorsHeaders(request, NextResponse.json({ error: 'Admin access required' }, { status: 403 }))
    }

    const cfg = getPlatformRevenueWalletConfig()
    if (!cfg) {
      return addCorsHeaders(request, NextResponse.json({
        entries: [], total: 0, page: 1, limit: 25, totalPages: 1,
        summary: [], grand: { txns: 0, gross: 0, reversed: 0, net: 0 },
        message: 'SUBSCRIPTION_REVENUE_USER_ID is not configured; no company revenue is being booked.',
      }))
    }

    const sp = request.nextUrl.searchParams
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '25', 10) || 25))
    const service = (sp.get('service') || 'all').trim().toLowerCase()
    const q = sp.get('q')?.trim() || ''

    const today = new Date()
    const defFrom = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
    const dateFrom = sp.get('date_from')?.trim() || defFrom.toISOString().slice(0, 10)
    const dateTo = sp.get('date_to')?.trim() || today.toISOString().slice(0, 10)
    const fromTs = `${dateFrom}T00:00:00`
    const toTs = `${dateTo}T23:59:59`

    const services: KnownService[] = service !== 'all' && (KNOWN_SERVICES as readonly string[]).includes(service)
      ? [service as KnownService]
      : [...KNOWN_SERVICES]

    const supabase = getSupabaseAdmin()

    // ── Summary (per-service aggregate over the whole range) ──────────────────
    const { data: summaryData, error: summaryErr } = await supabase.rpc('get_company_revenue_summary', {
      p_user_id: cfg.revenueUserId,
      p_from: fromTs,
      p_to: toTs,
      p_services: services,
    })
    if (summaryErr) {
      console.error('[admin/reports/revenue] summary', summaryErr)
      return addCorsHeaders(request, NextResponse.json({ error: summaryErr.message }, { status: 500 }))
    }
    const summary = (summaryData || []).map((r: any) => ({
      service_type: r.service_type,
      txns: Number(r.txns) || 0,
      gross: Number(r.gross) || 0,
      reversed: Number(r.reversed) || 0,
      net: Number(r.net) || 0,
    }))
    const grand = summary.reduce(
      (a: any, r: any) => ({
        txns: a.txns + r.txns, gross: a.gross + r.gross,
        reversed: a.reversed + r.reversed, net: a.net + r.net,
      }),
      { txns: 0, gross: 0, reversed: 0, net: 0 }
    )
    grand.gross = Math.round(grand.gross * 100) / 100
    grand.reversed = Math.round(grand.reversed * 100) / 100
    grand.net = Math.round(grand.net * 100) / 100

    // ── Detail rows (paginated COMPANY_REVENUE credits) ───────────────────────
    let query = supabase
      .from('wallet_ledger')
      .select('id, service_type, transaction_id, transaction_type, credit, reference_id, description, created_at', { count: 'exact' })
      .eq('retailer_id', cfg.revenueUserId)
      .eq('fund_category', 'revenue')
      .eq('transaction_type', 'COMPANY_REVENUE')
      .gte('created_at', fromTs)
      .lte('created_at', toTs)

    if (service !== 'all') query = query.eq('service_type', service)
    else query = query.in('service_type', services)
    if (q) {
      const esc = q.replace(/%/g, '\\%')
      query = query.or(`reference_id.ilike.%${esc}%,description.ilike.%${esc}%`)
    }

    const from = (page - 1) * limit
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1)

    if (error) {
      console.error('[admin/reports/revenue] detail', error)
      return addCorsHeaders(request, NextResponse.json({ error: error.message }, { status: 500 }))
    }

    const entries = (data || []).map((e: any) => ({
      id: e.id,
      service_type: e.service_type,
      transaction_id: e.transaction_id,
      reference_id: e.reference_id,
      revenue: Number(e.credit) || 0,
      description: e.description,
      created_at: e.created_at,
    }))

    return addCorsHeaders(request, NextResponse.json({
      entries,
      total: count ?? 0,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil((count || 0) / limit)),
      summary,
      grand,
      range: { from: dateFrom, to: dateTo },
    }))
  } catch (e: any) {
    console.error('[admin/reports/revenue]', e)
    return addCorsHeaders(request, NextResponse.json({ error: e.message || 'Server error' }, { status: 500 }))
  }
}
