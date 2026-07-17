import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { htmlToPdf } from '@/lib/pdf/html-to-pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sanitizeFilterValue(value: string): string {
  return value.replace(/[,()\\*%]/g, '').trim()
}

function escapeHtml(str: string | null | undefined): string {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

type ServiceType = 'all' | 'pos' | 'bbps' | 'aeps' | 'settlement'

interface NormalizedTransaction {
  id: string
  service_type: string
  transaction_id: string
  tid: string | null
  amount: number
  status: string
  commission: number
  mdr: number
  mdr_rate: number
  settlement_type: string
  scheme_name: string
  scheme_id: string | null
  retailer_id: string | null
  retailer_name: string | null
  distributor_id: string | null
  distributor_name: string | null
  master_distributor_id: string | null
  md_name: string | null
  payment_mode: string | null
  card_type: string | null
  device_serial: string | null
  description: string | null
  created_at: string
  raw: Record<string, any>
}

/**
 * GET /api/reports/service-transactions
 * 
 * Service-wise Transaction Report (All Roles)
 * Admin: Full access | MD: Downline | DT: Downline | RT: Own transactions
 * 
 * Query Params:
 *   service        - pos, bbps, aeps, payout, settlement, all (default: all)
 *   date_from      - ISO date string
 *   date_to        - ISO date string
 *   status         - transaction status filter
 *   search         - search by transaction ID
 *   user_id        - (admin/finance) filter by a specific retailer/user id
 *   distributor_id - (admin/finance) filter by all retailers under a distributor
 *   md_id          - (admin/finance) filter by all retailers under a master distributor
 *   limit          - pagination limit (default: 50)
 *   offset         - pagination offset (default: 0)
 *   format         - json (default), csv, excel, pdf
 */
export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { user, method } = await getCurrentUserWithFallback(request)
    console.log('[Service Txn Report] Auth:', method, '|', user?.email, '| Role:', user?.role)

    if (!user) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }

    const allowedRoles = ['admin', 'finance_executive', 'master_distributor', 'distributor', 'retailer', 'partner']
    if (!allowedRoles.includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const service = (searchParams.get('service') || 'all') as ServiceType
    const rawDateFrom = searchParams.get('date_from')
    const rawDateTo = searchParams.get('date_to')
    const dateFrom = rawDateFrom ? (rawDateFrom.includes('T') ? rawDateFrom : `${rawDateFrom}T00:00:00+05:30`) : null
    const dateTo = rawDateTo ? (rawDateTo.includes('T') ? rawDateTo : `${rawDateTo}T23:59:59+05:30`) : null
    const status = searchParams.get('status')
    const search = searchParams.get('search')
    const rawLimit = parseInt(searchParams.get('limit') || '25', 10)
    const isExport = ['csv', 'excel', 'pdf'].includes(searchParams.get('format') || '')
    const limit = isExport
      ? Math.min(10000, Math.max(1, rawLimit || 10000))
      : [10, 25, 100].includes(rawLimit) ? rawLimit : 25
    const offset = parseInt(searchParams.get('offset') || '0')
    const format = searchParams.get('format') || 'json'

    // Admin/finance-only targeted filters (specific user, DT downline, MD downline)
    let adminUserIds: string[] | null = null
    if (user.role === 'admin' || user.role === 'finance_executive') {
      const filterUserId = searchParams.get('user_id')?.trim()
      const filterDistributorId = searchParams.get('distributor_id')?.trim()
      const filterMdId = searchParams.get('md_id')?.trim()
      const filterPartnerId = searchParams.get('partner_id')?.trim()

      if (filterPartnerId) {
        // Partner uuid + linked merchant ids (partner txns are keyed by partner uuid in most tables)
        adminUserIds = await resolvePartnerRetailerScope(supabase, filterPartnerId)
      } else if (filterUserId) {
        adminUserIds = [filterUserId]
      } else if (filterDistributorId) {
        const { data: rets } = await supabase
          .from('retailers')
          .select('partner_id')
          .eq('distributor_id', filterDistributorId)
        adminUserIds = [filterDistributorId, ...(rets || []).map((r: any) => r.partner_id)]
      } else if (filterMdId) {
        const { data: dists } = await supabase
          .from('distributors')
          .select('partner_id')
          .eq('master_distributor_id', filterMdId)
        const distIds = (dists || []).map((d: any) => d.partner_id)
        const orParts = [`master_distributor_id.eq.${filterMdId}`]
        if (distIds.length > 0) orParts.push(`distributor_id.in.(${distIds.join(',')})`)
        const { data: rets } = await supabase
          .from('retailers')
          .select('partner_id')
          .or(orParts.join(','))
        adminUserIds = [filterMdId, ...distIds, ...(rets || []).map((r: any) => r.partner_id)]
      }
    }

    const downline = await resolveDownline(supabase, user)

    // DT/MD sub-filter: narrow downline to a selected retailer (DT/MD) or distributor (MD)
    if (user.role === 'distributor') {
      const fUser = searchParams.get('user_id')?.trim()
      if (fUser && downline.retailerIds.includes(fUser)) downline.retailerIds = [fUser]
    } else if (user.role === 'master_distributor') {
      const fUser = searchParams.get('user_id')?.trim()
      const fDist = searchParams.get('distributor_id')?.trim()
      if (fUser && downline.retailerIds.includes(fUser)) {
        downline.retailerIds = [fUser]
      } else if (fDist) {
        const { data: rets } = await supabase.from('retailers').select('partner_id').eq('distributor_id', fDist)
        const ids = (rets || []).map((r: any) => r.partner_id).filter((id: string) => downline.retailerIds.includes(id))
        downline.retailerIds = ids.length ? ids : ['__none__']
      }
    }

    const partnerRetailerScope =
      user.role === 'partner' && user.partner_id
        ? await resolvePartnerRetailerScope(supabase, user.partner_id)
        : null

    let results: NormalizedTransaction[] = []
    let total = 0

    // Fetch POS transactions
    if (service === 'all' || service === 'pos') {
      const { data, count } = await fetchPOSTransactions(
        supabase,
        user,
        downline,
        { dateFrom, dateTo, status, search, limit, offset, adminUserIds },
        partnerRetailerScope
      )
      results = results.concat(data)
      total += count
    }

    // Fetch BBPS transactions
    if (service === 'all' || service === 'bbps') {
      const { data, count } = await fetchBBPSTransactions(
        supabase,
        user,
        downline,
        { dateFrom, dateTo, status, search, limit, offset, adminUserIds },
        partnerRetailerScope
      )
      results = results.concat(data)
      total += count
    }

    // Fetch AEPS transactions
    if (service === 'all' || service === 'aeps') {
      const { data, count } = await fetchAEPSTransactions(
        supabase,
        user,
        downline,
        { dateFrom, dateTo, status, search, limit, offset, adminUserIds },
        partnerRetailerScope
      )
      results = results.concat(data)
      total += count
    }

    // Fetch Settlement transactions (includes both settlements and payout_transactions)
    if (service === 'all' || service === 'settlement') {
      const { data, count } = await fetchSettlementTransactions(
        supabase,
        user,
        downline,
        { dateFrom, dateTo, status, search, limit, offset, adminUserIds },
        partnerRetailerScope
      )
      results = results.concat(data)
      total += count
    }

    // Sort by date descending
    results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    // Enrich with scheme names where scheme_id is present
    const schemeIds = Array.from(new Set(results.map(r => r.scheme_id).filter(Boolean)))
    const schemeMap = new Map<string, string>()
    if (schemeIds.length > 0) {
      const { data: schemes } = await supabase
        .from('schemes')
        .select('id, name')
        .in('id', schemeIds)
      schemes?.forEach((s: any) => schemeMap.set(s.id, s.name))
    }
    results.forEach(r => {
      if (r.scheme_id && schemeMap.has(r.scheme_id)) {
        r.scheme_name = schemeMap.get(r.scheme_id)!
      }
    })

    // Enrich with user names
    await enrichUserNames(supabase, results)

    // Calculate summary
    const summary = {
      total_transactions: total,
      total_amount: results.reduce((s, r) => s + r.amount, 0),
      total_commission: results.reduce((s, r) => s + r.commission, 0),
      total_mdr: results.reduce((s, r) => s + r.mdr, 0),
      success_count: results.filter(r => ['success', 'captured', 'SUCCESS', 'CAPTURED'].includes(r.status)).length,
      failed_count: results.filter(r => ['failed', 'FAILED'].includes(r.status)).length,
      pending_count: results.filter(r => ['pending', 'PENDING', 'initiated'].includes(r.status)).length,
    }

    // Export formats
    if (format === 'csv') {
      return generateCSV(results, summary, dateFrom, dateTo, service)
    }

    if (format === 'excel') {
      return generateExcel(results, dateFrom, dateTo, service)
    }

    if (format === 'pdf') {
      return generatePDF(results, summary, dateFrom, dateTo, service, user)
    }

    return NextResponse.json({
      success: true,
      data: results,
      summary,
      pagination: {
        total,
        limit,
        offset,
        page: Math.floor(offset / limit) + 1,
        totalPages: Math.ceil(total / limit),
      }
    })

  } catch (error: any) {
    console.error('[Service Txn Report] Error:', error)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}

// ============================================================================
// DOWNLINE RESOLUTION
// ============================================================================

interface DownlineInfo {
  retailerIds: string[]
  distributorIds: string[]
  mdIds: string[]
}

async function resolveDownline(supabase: any, user: any): Promise<DownlineInfo> {
  const info: DownlineInfo = { retailerIds: [], distributorIds: [], mdIds: [] }

  if (user.role === 'admin' || user.role === 'finance_executive') {
    return info // full network view — no filtering needed
  }

  if (user.role === 'master_distributor' && user.partner_id) {
    const { data: dists } = await supabase
      .from('distributors')
      .select('partner_id')
      .eq('master_distributor_id', user.partner_id)
    info.distributorIds = (dists || []).map((d: any) => d.partner_id)

    const distIds = [user.partner_id, ...info.distributorIds]
    const { data: rets } = await supabase
      .from('retailers')
      .select('partner_id')
      .or(`master_distributor_id.eq.${user.partner_id},distributor_id.in.(${info.distributorIds.join(',')})`)
    info.retailerIds = (rets || []).map((r: any) => r.partner_id)
  }

  if (user.role === 'distributor' && user.partner_id) {
    const { data: rets } = await supabase
      .from('retailers')
      .select('partner_id')
      .eq('distributor_id', user.partner_id)
    info.retailerIds = (rets || []).map((r: any) => r.partner_id)
  }

  if (user.role === 'retailer' && user.partner_id) {
    info.retailerIds = [user.partner_id]
  }

  return info
}

/** Partner portal: own partner id + linked merchant IDs (BBPS/POS scope). */
async function resolvePartnerRetailerScope(supabase: any, partnerId: string): Promise<string[]> {
  const ids = new Set<string>([String(partnerId)])
  try {
    const { data: links } = await supabase
      .from('partner_merchant_links')
      .select('merchant_id')
      .eq('partner_id', partnerId)
      .eq('is_active', true)
    for (const row of links || []) {
      if (row?.merchant_id) ids.add(String(row.merchant_id))
    }
  } catch {
    /* partner_merchant_links may be absent in some databases */
  }
  return Array.from(ids)
}

// ============================================================================
// FETCH FUNCTIONS
// ============================================================================

interface FetchFilters {
  dateFrom: string | null
  dateTo: string | null
  status: string | null
  search: string | null
  limit: number
  offset: number
  /** Admin/finance-only: restrict to these user ids (specific user or a DT/MD downline) */
  adminUserIds?: string[] | null
}

async function fetchPOSTransactions(
  supabase: any,
  user: any,
  downline: DownlineInfo,
  filters: FetchFilters,
  partnerRetailerScope: string[] | null
) {
  let query = supabase
    .from('razorpay_pos_transactions')
    .select('*', { count: 'exact' })
    .order('transaction_time', { ascending: false })

  // Role-based filtering
  if (user.role === 'partner') {
    if (!partnerRetailerScope?.length) return { data: [], count: 0 }
    query = query.in('retailer_id', partnerRetailerScope)
  } else if (user.role === 'retailer') {
    query = query.eq('retailer_id', user.partner_id)
  } else if (user.role === 'distributor') {
    if (downline.retailerIds.length > 0) {
      query = query.in('retailer_id', downline.retailerIds)
    } else {
      return { data: [], count: 0 }
    }
  } else if (user.role === 'master_distributor') {
    if (downline.retailerIds.length > 0) {
      query = query.in('retailer_id', downline.retailerIds)
    } else {
      return { data: [], count: 0 }
    }
  } else if (filters.adminUserIds) {
    query = query.in('retailer_id', filters.adminUserIds)
  }

  if (filters.dateFrom) query = query.gte('transaction_time', filters.dateFrom)
  if (filters.dateTo) query = query.lte('transaction_time', filters.dateTo)
  if (filters.status) query = query.eq('display_status', filters.status.toUpperCase())
  if (filters.search) query = query.ilike('txn_id', `%${sanitizeFilterValue(filters.search)}%`)

  query = query.range(filters.offset, filters.offset + filters.limit - 1)

  const { data, count, error } = await query
  if (error) {
    console.error('[POS fetch error]', error)
    return { data: [], count: 0 }
  }

  const normalized: NormalizedTransaction[] = (data || []).map((tx: any) => ({
    id: tx.id,
    service_type: 'POS',
    transaction_id: tx.txn_id || tx.id,
    tid: tx.tid || null,
    amount: tx.amount || 0,
    status: tx.display_status || tx.status || 'PENDING',
    commission: 0,
    mdr: tx.mdr_amount || 0,
    mdr_rate: tx.mdr_rate || 0,
    settlement_type: tx.settlement_mode || 'AUTO_T1',
    scheme_name: tx.mdr_scheme_type || '-',
    scheme_id: tx.mdr_scheme_id || null,
    retailer_id: tx.retailer_id,
    retailer_name: null,
    distributor_id: tx.distributor_id,
    distributor_name: null,
    master_distributor_id: tx.master_distributor_id,
    md_name: null,
    payment_mode: tx.payment_mode,
    card_type: tx.card_type,
    device_serial: tx.device_serial,
    description: tx.merchant_name ? `POS - ${tx.merchant_name}` : 'POS Transaction',
    created_at: tx.transaction_time || tx.created_at,
    raw: tx,
  }))

  return { data: normalized, count: count || 0 }
}

async function fetchBBPSTransactions(
  supabase: any,
  user: any,
  downline: DownlineInfo,
  filters: FetchFilters,
  partnerRetailerScope: string[] | null
) {
  let query = supabase
    .from('bbps_transactions')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (user.role === 'partner') {
    if (!partnerRetailerScope?.length) return { data: [], count: 0 }
    query = query.in('retailer_id', partnerRetailerScope)
  } else if (user.role === 'retailer') {
    query = query.eq('retailer_id', user.partner_id)
  } else if (user.role === 'distributor') {
    if (downline.retailerIds.length > 0) {
      query = query.in('retailer_id', downline.retailerIds)
    } else {
      return { data: [], count: 0 }
    }
  } else if (user.role === 'master_distributor') {
    if (downline.retailerIds.length > 0) {
      query = query.in('retailer_id', downline.retailerIds)
    } else {
      return { data: [], count: 0 }
    }
  } else if (filters.adminUserIds) {
    query = query.in('retailer_id', filters.adminUserIds)
  }

  if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom)
  if (filters.dateTo) query = query.lte('created_at', filters.dateTo)
  if (filters.status) query = query.eq('status', filters.status.toLowerCase())
  if (filters.search) query = query.ilike('transaction_id', `%${sanitizeFilterValue(filters.search)}%`)

  query = query.range(filters.offset, filters.offset + filters.limit - 1)

  const { data, count, error } = await query
  if (error) {
    console.error('[BBPS fetch error]', error)
    return { data: [], count: 0 }
  }

  const normalized: NormalizedTransaction[] = (data || []).map((tx: any) => ({
    id: tx.id,
    service_type: 'BBPS',
    transaction_id: tx.transaction_id || tx.id,
    tid: null,
    amount: tx.amount_paid || tx.bill_amount || 0,
    status: tx.status || 'pending',
    commission: tx.commission_amount || 0,
    mdr: 0,
    mdr_rate: tx.commission_rate || 0,
    settlement_type: '-',
    scheme_name: '-',
    scheme_id: null,
    retailer_id: tx.retailer_id,
    retailer_name: null,
    distributor_id: tx.distributor_id,
    distributor_name: null,
    master_distributor_id: tx.master_distributor_id,
    md_name: null,
    payment_mode: 'BBPS',
    card_type: null,
    device_serial: null,
    description: tx.biller_name ? `BBPS - ${tx.biller_name}` : 'BBPS Payment',
    created_at: tx.created_at,
    raw: tx,
  }))

  let totalCount = count || 0

  // Also include BBPS-2 (Pay2New) and Credit Card (Rechargekit) from wallet_ledger
  try {
    let lq = supabase
      .from('wallet_ledger')
      .select('*', { count: 'exact' })
      .in('service_type', ['pay2new', 'rechargekit'])
      .in('transaction_type', ['PAY2NEW_DEBIT', 'RECHARGEKIT_CC_DEBIT'])
      .order('created_at', { ascending: false })

    if (user.role === 'partner') {
      if (partnerRetailerScope?.length) lq = lq.in('retailer_id', partnerRetailerScope)
      else lq = lq.eq('retailer_id', '__none__')
    } else if (user.role === 'retailer') {
      lq = lq.eq('retailer_id', user.partner_id)
    } else if (user.role === 'distributor' || user.role === 'master_distributor') {
      if (downline.retailerIds.length > 0) lq = lq.in('retailer_id', downline.retailerIds)
      else lq = lq.eq('retailer_id', '__none__')
    } else if (filters.adminUserIds) {
      lq = lq.in('retailer_id', filters.adminUserIds)
    }

    if (filters.dateFrom) lq = lq.gte('created_at', filters.dateFrom)
    if (filters.dateTo) lq = lq.lte('created_at', filters.dateTo)
    if (filters.status) lq = lq.eq('status', filters.status.toLowerCase())
    if (filters.search) lq = lq.ilike('reference_id', `%${sanitizeFilterValue(filters.search)}%`)

    lq = lq.range(filters.offset, filters.offset + filters.limit - 1)

    const { data: ledgerData, count: ledgerCount } = await lq
    if (ledgerData) {
      totalCount += ledgerCount || 0
      for (const tx of ledgerData) {
        const label = tx.service_type === 'rechargekit' ? 'Credit Card' : 'BBPS-2'
        normalized.push({
          id: tx.id,
          service_type: 'BBPS',
          transaction_id: tx.reference_id || tx.id,
          tid: null,
          amount: Number(tx.debit) || 0,
          status: tx.status || 'completed',
          commission: 0,
          mdr: 0,
          mdr_rate: 0,
          settlement_type: '-',
          scheme_name: '-',
          scheme_id: null,
          retailer_id: tx.retailer_id,
          retailer_name: null,
          distributor_id: null,
          distributor_name: null,
          master_distributor_id: null,
          md_name: null,
          payment_mode: label,
          card_type: null,
          device_serial: null,
          description: tx.description || `${label} Payment`,
          created_at: tx.created_at,
          raw: tx,
        })
      }
    }
  } catch (err) {
    console.error('[BBPS-2/CC ledger fetch error]', err)
  }

  return { data: normalized, count: totalCount }
}

async function fetchAEPSTransactions(
  supabase: any,
  user: any,
  downline: DownlineInfo,
  filters: FetchFilters,
  partnerRetailerScope: string[] | null
) {
  let query = supabase
    .from('aeps_transactions')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (user.role === 'partner') {
    if (!partnerRetailerScope?.length) return { data: [], count: 0 }
    query = query.in('user_id', partnerRetailerScope)
  } else if (user.role === 'retailer') {
    query = query.eq('user_id', user.partner_id)
  } else if (user.role === 'distributor') {
    if (downline.retailerIds.length > 0) {
      query = query.in('user_id', downline.retailerIds)
    } else {
      return { data: [], count: 0 }
    }
  } else if (user.role === 'master_distributor') {
    if (downline.retailerIds.length > 0) {
      query = query.in('user_id', downline.retailerIds)
    } else {
      return { data: [], count: 0 }
    }
  } else if (filters.adminUserIds) {
    query = query.in('user_id', filters.adminUserIds)
  }

  if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom)
  if (filters.dateTo) query = query.lte('created_at', filters.dateTo)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.search) query = query.ilike('id', `%${sanitizeFilterValue(filters.search)}%`)

  query = query.range(filters.offset, filters.offset + filters.limit - 1)

  const { data, count, error } = await query
  if (error) {
    console.error('[AEPS fetch error]', error)
    return { data: [], count: 0 }
  }

  // Enrich AEPS transactions with commission from commission_ledger
  const txnIds = (data || []).filter((tx: any) => tx.commission_id).map((tx: any) => tx.commission_id)
  const commissionMap = new Map<string, { rt_amount: number; tds_amount: number; scheme_name: string }>()
  if (txnIds.length > 0) {
    const { data: commissions } = await supabase
      .from('commission_ledger')
      .select('id, rt_amount, tds_amount, service_type')
      .in('id', txnIds)
    commissions?.forEach((c: any) => commissionMap.set(c.id, {
      rt_amount: c.rt_amount || 0,
      tds_amount: c.tds_amount || 0,
      scheme_name: c.service_type || '-',
    }))
  }

  const normalized: NormalizedTransaction[] = (data || []).map((tx: any) => {
    const comm = tx.commission_id ? commissionMap.get(tx.commission_id) : null
    return {
      id: tx.id,
      service_type: 'AEPS',
      transaction_id: tx.id,
      tid: null,
      amount: tx.amount || 0,
      status: tx.status || 'pending',
      commission: comm?.rt_amount || 0,
      mdr: comm?.tds_amount || 0,
      mdr_rate: 0,
      settlement_type: '-',
      scheme_name: comm?.scheme_name || '-',
      scheme_id: null,
      retailer_id: tx.user_id,
      retailer_name: null,
      distributor_id: null,
      distributor_name: null,
      master_distributor_id: null,
      md_name: null,
      payment_mode: 'AEPS',
      card_type: null,
      device_serial: null,
      description: tx.transaction_type ? `AEPS - ${tx.transaction_type}` : 'AEPS Transaction',
      created_at: tx.created_at,
      raw: tx,
    }
  })

  return { data: normalized, count: count || 0 }
}

async function fetchSettlementTransactions(
  supabase: any,
  user: any,
  downline: DownlineInfo,
  filters: FetchFilters,
  partnerRetailerScope: string[] | null
) {
  let allResults: NormalizedTransaction[] = []
  let totalCount = 0

  // 1. Query `settlements` table (wallet-to-bank settlements)
  try {
    let sQuery = supabase
      .from('settlements')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (user.role === 'partner') {
      if (!partnerRetailerScope?.length) {
        sQuery = sQuery.eq('user_id', '__none__')
      } else {
        sQuery = sQuery.in('user_id', partnerRetailerScope)
      }
    } else if (user.role === 'retailer') {
      sQuery = sQuery.eq('user_id', user.partner_id)
    } else if (user.role === 'distributor') {
      if (downline.retailerIds.length > 0) {
        sQuery = sQuery.in('user_id', downline.retailerIds)
      } else {
        sQuery = sQuery.eq('user_id', '__none__')
      }
    } else if (user.role === 'master_distributor') {
      if (downline.retailerIds.length > 0) {
        sQuery = sQuery.in('user_id', downline.retailerIds)
      } else {
        sQuery = sQuery.eq('user_id', '__none__')
      }
    } else if (filters.adminUserIds) {
      sQuery = sQuery.in('user_id', filters.adminUserIds)
    }

    if (filters.dateFrom) sQuery = sQuery.gte('created_at', filters.dateFrom)
    if (filters.dateTo) sQuery = sQuery.lte('created_at', filters.dateTo)
    if (filters.status) sQuery = sQuery.eq('status', filters.status)

    sQuery = sQuery.range(filters.offset, filters.offset + filters.limit - 1)

    const { data: sData, count: sCount, error: sError } = await sQuery
    if (sError) {
      console.error('[Settlement table fetch error]', sError)
    } else if (sData) {
      totalCount += sCount || 0
      allResults = allResults.concat(sData.map((tx: any) => ({
        id: tx.id,
        service_type: 'Settlement',
        transaction_id: tx.id,
        tid: null,
        amount: tx.amount || 0,
        status: tx.status || 'pending',
        commission: 0,
        mdr: tx.charge || 0,
        mdr_rate: 0,
        settlement_type: tx.settlement_mode || 'T1',
        scheme_name: '-',
        scheme_id: null,
        retailer_id: tx.user_id,
        retailer_name: null,
        distributor_id: null,
        distributor_name: null,
        master_distributor_id: null,
        md_name: null,
        payment_mode: tx.settlement_mode || 'Settlement',
        card_type: null,
        device_serial: null,
        description: `Settlement - ${tx.settlement_mode || 'Bank Transfer'} (${tx.bank_account_name || 'N/A'})`,
        created_at: tx.created_at,
        raw: tx,
      })))
    }
  } catch (err) {
    console.error('[Settlement table error]', err)
  }

  // 2. Query `payout_transactions` table (bank transfer payouts)
  try {
    let pQuery = supabase
      .from('payout_transactions')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (user.role === 'partner') {
      if (!partnerRetailerScope?.length) {
        pQuery = pQuery.eq('retailer_id', '__none__')
      } else {
        pQuery = pQuery.in('retailer_id', partnerRetailerScope)
      }
    } else if (user.role === 'retailer') {
      pQuery = pQuery.eq('retailer_id', user.partner_id)
    } else if (user.role === 'distributor') {
      if (downline.retailerIds.length > 0) {
        pQuery = pQuery.in('retailer_id', downline.retailerIds)
      } else {
        pQuery = pQuery.eq('retailer_id', '__none__')
      }
    } else if (user.role === 'master_distributor') {
      if (downline.retailerIds.length > 0) {
        pQuery = pQuery.in('retailer_id', downline.retailerIds)
      } else {
        pQuery = pQuery.eq('retailer_id', '__none__')
      }
    } else if (filters.adminUserIds) {
      pQuery = pQuery.in('retailer_id', filters.adminUserIds)
    }

    if (filters.dateFrom) pQuery = pQuery.gte('created_at', filters.dateFrom)
    if (filters.dateTo) pQuery = pQuery.lte('created_at', filters.dateTo)
    if (filters.status) pQuery = pQuery.eq('status', filters.status)

    pQuery = pQuery.range(filters.offset, filters.offset + filters.limit - 1)

    const { data: pData, count: pCount, error: pError } = await pQuery
    if (pError) {
      console.error('[Payout transactions fetch error]', pError)
    } else if (pData) {
      totalCount += pCount || 0
      allResults = allResults.concat(pData.map((tx: any) => ({
        id: tx.id,
        service_type: 'Settlement',
        transaction_id: tx.transaction_id || tx.client_ref_id || tx.id,
        tid: null,
        amount: tx.amount || 0,
        status: tx.status || 'pending',
        commission: 0,
        mdr: tx.charges || 0,
        mdr_rate: 0,
        settlement_type: tx.transfer_mode || 'IMPS',
        scheme_name: tx.scheme_name || '-',
        scheme_id: tx.scheme_id || null,
        retailer_id: tx.retailer_id,
        retailer_name: null,
        distributor_id: null,
        distributor_name: null,
        master_distributor_id: null,
        md_name: null,
        payment_mode: tx.transfer_mode || 'IMPS',
        card_type: null,
        device_serial: null,
        description: tx.account_holder_name
          ? `Settlement to ${tx.account_holder_name} (${tx.transfer_mode || 'IMPS'})`
          : `Settlement - ${tx.transfer_mode || 'Bank Transfer'}`,
        created_at: tx.created_at,
        raw: tx,
      })))
    }
  } catch (err) {
    console.error('[Payout transactions error]', err)
  }

  // 3. Query `shadval_settlement` table (Settlement-2 bank transfers)
  try {
    let svQuery = supabase
      .from('shadval_settlement')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (user.role === 'partner') {
      if (!partnerRetailerScope?.length) {
        svQuery = svQuery.eq('retailer_id', '__none__')
      } else {
        svQuery = svQuery.in('retailer_id', partnerRetailerScope)
      }
    } else if (user.role === 'retailer') {
      svQuery = svQuery.eq('retailer_id', user.partner_id)
    } else if (user.role === 'distributor' || user.role === 'master_distributor') {
      if (downline.retailerIds.length > 0) {
        svQuery = svQuery.in('retailer_id', downline.retailerIds)
      } else {
        svQuery = svQuery.eq('retailer_id', '__none__')
      }
    } else if (filters.adminUserIds) {
      svQuery = svQuery.in('retailer_id', filters.adminUserIds)
    }

    if (filters.dateFrom) svQuery = svQuery.gte('created_at', filters.dateFrom)
    if (filters.dateTo) svQuery = svQuery.lte('created_at', filters.dateTo)
    if (filters.status) svQuery = svQuery.eq('status', filters.status.toUpperCase())
    if (filters.search) svQuery = svQuery.ilike('reference_id', `%${sanitizeFilterValue(filters.search)}%`)

    svQuery = svQuery.range(filters.offset, filters.offset + filters.limit - 1)

    const { data: svData, count: svCount, error: svError } = await svQuery
    if (svError) {
      console.error('[Shadval settlement fetch error]', svError)
    } else if (svData) {
      totalCount += svCount || 0
      allResults = allResults.concat(svData.map((tx: any) => ({
        id: tx.id,
        service_type: 'Settlement',
        transaction_id: tx.reference_id || tx.order_id || tx.id,
        tid: null,
        amount: Number(tx.amount) || 0,
        status: tx.status || 'PENDING',
        commission: 0,
        mdr: Number(tx.charges) || 0,
        mdr_rate: 0,
        settlement_type: tx.mode || 'IMPS',
        scheme_name: tx.scheme_name || '-',
        scheme_id: tx.scheme_id || null,
        retailer_id: tx.retailer_id,
        retailer_name: null,
        distributor_id: null,
        distributor_name: null,
        master_distributor_id: null,
        md_name: null,
        payment_mode: tx.mode || 'IMPS',
        card_type: null,
        device_serial: null,
        description: tx.account_holder_name
          ? `Settlement-2 to ${tx.account_holder_name} (${tx.mode || 'IMPS'})`
          : `Settlement-2 - ${tx.mode || 'Bank Transfer'}`,
        created_at: tx.created_at,
        raw: tx,
      })))
    }
  } catch (err) {
    console.error('[Shadval settlement error]', err)
  }

  return { data: allResults, count: totalCount }
}

// ============================================================================
// ENRICH USER NAMES
// ============================================================================

async function enrichUserNames(supabase: any, results: NormalizedTransaction[]) {
  const retailerIds = Array.from(new Set(results.map(r => r.retailer_id).filter(Boolean)))
  const distributorIds = Array.from(new Set(results.map(r => r.distributor_id).filter(Boolean)))
  const mdIds = Array.from(new Set(results.map(r => r.master_distributor_id).filter(Boolean)))

  const nameMap = new Map<string, string>()

  if (retailerIds.length > 0) {
    const { data } = await supabase.from('retailers').select('partner_id, name').in('partner_id', retailerIds)
    data?.forEach((r: any) => nameMap.set(r.partner_id, r.name))
  }
  if (distributorIds.length > 0) {
    const { data } = await supabase.from('distributors').select('partner_id, name').in('partner_id', distributorIds)
    data?.forEach((d: any) => nameMap.set(d.partner_id, d.name))
  }
  if (mdIds.length > 0) {
    const { data } = await supabase.from('master_distributors').select('partner_id, name').in('partner_id', mdIds)
    data?.forEach((m: any) => nameMap.set(m.partner_id, m.name))
  }

  results.forEach(r => {
    if (r.retailer_id && nameMap.has(r.retailer_id)) r.retailer_name = nameMap.get(r.retailer_id)!
    if (r.distributor_id && nameMap.has(r.distributor_id)) r.distributor_name = nameMap.get(r.distributor_id)!
    if (r.master_distributor_id && nameMap.has(r.master_distributor_id)) r.md_name = nameMap.get(r.master_distributor_id)!
  })
}

// ============================================================================
// EXPORT - CSV
// ============================================================================

function generateCSV(results: NormalizedTransaction[], summary: any, dateFrom: string | null, dateTo: string | null, service: string) {
  const headers = [
    'Date', 'Service', 'Transaction ID', 'TID', 'Amount (₹)', 'Status',
    'Commission (₹)', 'MDR (₹)', 'MDR Rate (%)', 'Settlement Type',
    'Scheme Name',
    'Retailer Name', 'Retailer ID',
    'Distributor Name', 'Distributor ID',
    'MD Name', 'MD ID',
    'Payment Mode', 'Card Type', 'Device Serial', 'Description'
  ]

  const rows = results.map(r => [
    new Date(r.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    r.service_type,
    r.transaction_id,
    r.tid || '-',
    r.amount.toFixed(2),
    r.status,
    r.commission.toFixed(2),
    r.mdr.toFixed(2),
    (r.mdr_rate * 100).toFixed(3),
    r.settlement_type,
    r.scheme_name,
    r.retailer_name || '-',
    r.retailer_id || '-',
    r.distributor_name || '-',
    r.distributor_id || '-',
    r.md_name || '-',
    r.master_distributor_id || '-',
    r.payment_mode || '-',
    r.card_type || '-',
    r.device_serial || '-',
    r.description || '-',
  ])

  const escapeCSV = (val: string) => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`
    }
    return val
  }

  const csvContent = [
    `Service Transaction Report`,
    `Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
    `Service: ${service}`,
    `Date Range: ${dateFrom || 'All'} to ${dateTo || 'Now'}`,
    `Total Transactions: ${summary.total_transactions}`,
    `Total Amount: ₹${summary.total_amount.toFixed(2)}`,
    `Total Commission: ₹${summary.total_commission.toFixed(2)}`,
    `Total MDR: ₹${summary.total_mdr.toFixed(2)}`,
    '',
    headers.join(','),
    ...rows.map(row => row.map(escapeCSV).join(','))
  ].join('\n')

  return new NextResponse(csvContent, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="service_transaction_report_${Date.now()}.csv"`,
    },
  })
}

// ============================================================================
// EXPORT - EXCEL (XML Spreadsheet)
// ============================================================================

function generateExcel(results: NormalizedTransaction[], dateFrom: string | null, dateTo: string | null, service: string) {
  const escapeXml = (str: string) =>
    String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')

  const headers = [
    'Date', 'Service', 'Transaction ID', 'TID', 'Amount (₹)', 'Status',
    'Commission (₹)', 'MDR (₹)', 'MDR Rate (%)', 'Settlement Type', 'Scheme Name',
    'Retailer Name', 'Retailer ID', 'Distributor Name', 'Distributor ID',
    'MD Name', 'MD ID', 'Payment Mode', 'Card Type', 'Device Serial', 'Description',
  ]

  const headerRow = `<Row>${headers.map(h => `<Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`).join('')}</Row>`

  const xmlRows = results.map(r => {
    const strCell = (v: string | null | undefined) =>
      `<Cell><Data ss:Type="String">${escapeXml(v || '-')}</Data></Cell>`
    const numCell = (v: number) => `<Cell><Data ss:Type="Number">${v}</Data></Cell>`
    return `<Row>
      ${strCell(new Date(r.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))}
      ${strCell(r.service_type)}
      ${strCell(r.transaction_id)}
      ${strCell(r.tid)}
      ${numCell(r.amount)}
      ${strCell(r.status)}
      ${numCell(r.commission)}
      ${numCell(r.mdr)}
      ${numCell(Math.round(r.mdr_rate * 100000) / 1000)}
      ${strCell(r.settlement_type)}
      ${strCell(r.scheme_name)}
      ${strCell(r.retailer_name)}
      ${strCell(r.retailer_id)}
      ${strCell(r.distributor_name)}
      ${strCell(r.distributor_id)}
      ${strCell(r.md_name)}
      ${strCell(r.master_distributor_id)}
      ${strCell(r.payment_mode)}
      ${strCell(r.card_type)}
      ${strCell(r.device_serial)}
      ${strCell(r.description)}
    </Row>`
  }).join('\n')

  const sheetName = service === 'all' ? 'All Services' : service.toUpperCase()
  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="${escapeXml(sheetName)}">
    <Table>
      ${headerRow}
      ${xmlRows}
    </Table>
  </Worksheet>
</Workbook>`

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/vnd.ms-excel',
      'Content-Disposition': `attachment; filename="service_transaction_report_${service}_${Date.now()}.xls"`,
    },
  })
}

// ============================================================================
// EXPORT - PDF (real PDF via Puppeteer, HTML fallback if Chrome unavailable)
// ============================================================================

async function generatePDF(results: NormalizedTransaction[], summary: any, dateFrom: string | null, dateTo: string | null, service: string, user: any) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Service Transaction Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; padding: 30px; color: #333; font-size: 11px; }
    .header { text-align: center; margin-bottom: 25px; border-bottom: 3px solid #4F46E5; padding-bottom: 15px; }
    .header h1 { font-size: 22px; color: #4F46E5; margin-bottom: 5px; }
    .header p { font-size: 12px; color: #666; }
    .meta { display: flex; justify-content: space-between; margin-bottom: 20px; background: #F9FAFB; padding: 12px; border-radius: 8px; }
    .meta-item { text-align: center; }
    .meta-item .label { font-size: 10px; color: #888; text-transform: uppercase; }
    .meta-item .value { font-size: 16px; font-weight: bold; color: #333; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
    .summary-card { background: #F0F9FF; padding: 12px; border-radius: 8px; text-align: center; border: 1px solid #BFDBFE; }
    .summary-card .num { font-size: 18px; font-weight: bold; color: #1E40AF; }
    .summary-card .lbl { font-size: 10px; color: #6B7280; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th { background: #4F46E5; color: white; padding: 8px 6px; text-align: left; font-size: 10px; font-weight: 600; }
    td { padding: 6px; border-bottom: 1px solid #E5E7EB; font-size: 10px; }
    tr:nth-child(even) { background: #F9FAFB; }
    tr:hover { background: #EEF2FF; }
    .status-success { color: #059669; font-weight: 600; }
    .status-failed { color: #DC2626; font-weight: 600; }
    .status-pending { color: #D97706; font-weight: 600; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 9px; font-weight: 600; }
    .badge-pos { background: #DBEAFE; color: #1E40AF; }
    .badge-bbps { background: #D1FAE5; color: #065F46; }
    .badge-aeps { background: #FEF3C7; color: #92400E; }
    .badge-settlement { background: #EDE9FE; color: #5B21B6; }
    .footer { margin-top: 20px; text-align: center; font-size: 10px; color: #888; border-top: 1px solid #E5E7EB; padding-top: 10px; }
    .amount { font-family: monospace; text-align: right; }
    @media print { body { padding: 15px; font-size: 9px; } th { font-size: 8px; } td { font-size: 8px; padding: 4px; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>Service-wise Transaction Report</h1>
    <p>Generated on ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} | User: ${escapeHtml(user.name || user.email)} (${escapeHtml(user.role)})</p>
  </div>

  <div class="meta">
    <div class="meta-item">
      <div class="label">Service Filter</div>
      <div class="value">${service === 'all' ? 'All Services' : service.toUpperCase()}</div>
    </div>
    <div class="meta-item">
      <div class="label">Date Range</div>
      <div class="value">${dateFrom || 'Start'} → ${dateTo || 'Now'}</div>
    </div>
    <div class="meta-item">
      <div class="label">Total Records</div>
      <div class="value">${summary.total_transactions}</div>
    </div>
  </div>

  <div class="summary-grid">
    <div class="summary-card">
      <div class="num">₹${summary.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
      <div class="lbl">Total Amount</div>
    </div>
    <div class="summary-card">
      <div class="num">₹${summary.total_commission.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
      <div class="lbl">Total Commission</div>
    </div>
    <div class="summary-card">
      <div class="num">₹${summary.total_mdr.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
      <div class="lbl">Total MDR</div>
    </div>
    <div class="summary-card">
      <div class="num">${summary.success_count} / ${summary.failed_count} / ${summary.pending_count}</div>
      <div class="lbl">Success / Failed / Pending</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Date</th>
        <th>Service</th>
        <th>Txn ID / TID</th>
        <th>Amount</th>
        <th>Status</th>
        <th>Commission</th>
        <th>MDR</th>
        <th>Settlement</th>
        <th>Scheme</th>
        <th>Retailer</th>
        <th>Retailer ID</th>
        <th>Distributor</th>
        <th>Distributor ID</th>
        <th>MD</th>
        <th>MD ID</th>
      </tr>
    </thead>
    <tbody>
      ${results.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${new Date(r.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
        <td><span class="badge badge-${escapeHtml(r.service_type.toLowerCase())}">${escapeHtml(r.service_type)}</span></td>
        <td style="font-family: monospace; font-size: 9px;">${escapeHtml(r.transaction_id.length > 16 ? r.transaction_id.slice(0, 16) + '...' : r.transaction_id)}${r.tid ? '<br/>TID: ' + escapeHtml(r.tid) : ''}</td>
        <td class="amount">₹${r.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
        <td class="${['success', 'captured', 'SUCCESS', 'CAPTURED'].includes(r.status) ? 'status-success' : ['failed', 'FAILED'].includes(r.status) ? 'status-failed' : 'status-pending'}">${escapeHtml(r.status)}</td>
        <td class="amount">₹${r.commission.toFixed(2)}</td>
        <td class="amount">₹${r.mdr.toFixed(2)}</td>
        <td>${escapeHtml(r.settlement_type)}</td>
        <td>${escapeHtml(r.scheme_name)}</td>
        <td>${escapeHtml(r.retailer_name || '-')}</td>
        <td style="font-family: monospace; font-size: 8px;">${escapeHtml(r.retailer_id || '-')}</td>
        <td>${escapeHtml(r.distributor_name || '-')}</td>
        <td style="font-family: monospace; font-size: 8px;">${escapeHtml(r.distributor_id || '-')}</td>
        <td>${escapeHtml(r.md_name || '-')}</td>
        <td style="font-family: monospace; font-size: 8px;">${escapeHtml(r.master_distributor_id || '-')}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="footer">
    <p>This is a system-generated report. &copy; ${new Date().getFullYear()} Same Day Solution</p>
  </div>
</body>
</html>`

  // Render a real PDF with headless Chrome; wide table → landscape A4
  const pdf = await htmlToPdf(html, { landscape: true })
  if (pdf) {
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="service_transaction_report_${service}_${Date.now()}.pdf"`,
      },
    })
  }

  // Fallback: printable HTML (open in browser → Ctrl+P) when Chrome is unavailable
  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="service_transaction_report_${Date.now()}.html"`,
    },
  })
}
