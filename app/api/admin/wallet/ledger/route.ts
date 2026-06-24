import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { isAdminOrFinance } from '@/lib/auth-roles'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { getPlatformRevenueWalletConfig } from '@/lib/wallet/platform-revenue-wallet'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/wallet/ledger
 * Paginated wallet_ledger for all users (admin). Query:
 * - page, limit (max 100)
 * - user_id: filter retailer_id (wallet owner key)
 * - user_role: retailer | distributor | master_distributor
 * - wallet_type: primary | aeps | all
 * - scope: all | platform (platform revenue wallet only — SUBSCRIPTION_REVENUE_USER_ID)
 * - q: search description (ilike)
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || !isAdminOrFinance(user)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const sp = request.nextUrl.searchParams
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '25', 10) || 25))
    const userId = sp.get('user_id')?.trim() || ''
    const userRole = sp.get('user_role')?.trim() || ''
    const walletType = sp.get('wallet_type') || 'primary'
    const scope = sp.get('scope') || 'all'
    const serviceType = sp.get('service_type')?.trim() || ''
    const transactionType = sp.get('transaction_type')?.trim() || ''
    const dateFrom = sp.get('date_from')?.trim() || ''
    const dateTo = sp.get('date_to')?.trim() || ''
    const q = sp.get('q')?.trim() || ''

    const supabase = getSupabaseAdmin()
    let query = supabase.from('wallet_ledger').select('*', { count: 'exact' })

    if (scope === 'platform') {
      const cfg = getPlatformRevenueWalletConfig()
      if (!cfg) {
        return NextResponse.json({
          entries: [],
          total: 0,
          page,
          limit,
          message: 'SUBSCRIPTION_REVENUE_USER_ID is not configured; platform scope is empty.',
        })
      }
      query = query.eq('retailer_id', cfg.revenueUserId)
    } else if (userId) {
      query = query.eq('retailer_id', userId)
    }

    if (userRole) {
      query = query.eq('user_role', userRole)
    }
    if (walletType && walletType !== 'all') {
      query = query.eq('wallet_type', walletType)
    }
    if (serviceType && serviceType !== 'all') {
      query = query.eq('service_type', serviceType)
    }
    if (transactionType && transactionType !== 'all') {
      query = query.eq('transaction_type', transactionType)
    }
    if (dateFrom) {
      query = query.gte('created_at', `${dateFrom}T00:00:00`)
    }
    if (dateTo) {
      query = query.lte('created_at', `${dateTo}T23:59:59`)
    }
    if (q) {
      query = query.ilike('description', `%${q.replace(/%/g, '\\%')}%`)
    }

    const from = (page - 1) * limit
    const to = from + limit - 1
    const { data, error, count } = await query.order('created_at', { ascending: false }).range(from, to)

    if (error) {
      console.error('[admin/wallet/ledger]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const entries = data || []
    const uniqueIds = [...new Set(entries.map((e) => e.retailer_id).filter(Boolean))]

    let nameMap: Record<string, { user_name?: string; partner_name?: string }> = {}
    if (uniqueIds.length > 0) {
      const [retRes, partRes] = await Promise.all([
        supabase.from('retailers').select('partner_id, name, business_name').in('partner_id', uniqueIds),
        supabase.from('partners').select('id, name, business_name').in('id', uniqueIds),
      ])
      for (const r of retRes.data || []) {
        nameMap[r.partner_id] = {
          ...nameMap[r.partner_id],
          user_name: r.name || r.business_name || undefined,
        }
      }
      for (const p of partRes.data || []) {
        nameMap[p.id] = {
          ...nameMap[p.id],
          partner_name: p.name || p.business_name || undefined,
        }
      }
    }

    const enriched = entries.map((e) => ({
      ...e,
      user_name: nameMap[e.retailer_id]?.user_name || null,
      partner_name: nameMap[e.retailer_id]?.partner_name || null,
    }))

    return NextResponse.json({
      entries: enriched,
      total: count ?? 0,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil((count || 0) / limit)),
    })
  } catch (e: any) {
    console.error('[admin/wallet/ledger]', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
