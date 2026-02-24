import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
 *   service    - pos, bbps, aeps, payout, settlement, all (default: all)
 *   date_from  - ISO date string
 *   date_to    - ISO date string
 *   status     - transaction status filter
 *   search     - search by transaction ID
 *   limit      - pagination limit (default: 50)
 *   offset     - pagination offset (default: 0)
 *   format     - json (default), csv, pdf
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

    const allowedRoles = ['admin', 'master_distributor', 'distributor', 'retailer']
    if (!allowedRoles.includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const service = (searchParams.get('service') || 'all') as ServiceType
    const dateFrom = searchParams.get('date_from')
    const dateTo = searchParams.get('date_to')
    const status = searchParams.get('status')
    const search = searchParams.get('search')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')
    const format = searchParams.get('format') || 'json'

    // Resolve downline IDs based on role
    const downline = await resolveDownline(supabase, user)

    let results: NormalizedTransaction[] = []
    let total = 0

    // Fetch POS transactions
    if (service === 'all' || service === 'pos') {
      const { data, count } = await fetchPOSTransactions(supabase, user, downline, { dateFrom, dateTo, status, search, limit, offset })
      results = results.concat(data)
      total += count
    }

    // Fetch BBPS transactions
    if (service === 'all' || service === 'bbps') {
      const { data, count } = await fetchBBPSTransactions(supabase, user, downline, { dateFrom, dateTo, status, search, limit, offset })
      results = results.concat(data)
      total += count
    }

    // Fetch AEPS transactions
    if (service === 'all' || service === 'aeps') {
      const { data, count } = await fetchAEPSTransactions(supabase, user, downline, { dateFrom, dateTo, status, search, limit, offset })
      results = results.concat(data)
      total += count
    }

    // Fetch Settlement transactions (includes both settlements and payout_transactions)
    if (service === 'all' || service === 'settlement') {
      const { data, count } = await fetchSettlementTransactions(supabase, user, downline, { dateFrom, dateTo, status, search, limit, offset })
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

  if (user.role === 'admin') {
    return info // admin sees everything — no filtering needed
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
}

async function fetchPOSTransactions(supabase: any, user: any, downline: DownlineInfo, filters: FetchFilters) {
  let query = supabase
    .from('razorpay_pos_transactions')
    .select('*', { count: 'exact' })
    .order('transaction_time', { ascending: false })

  // Role-based filtering
  if (user.role === 'retailer') {
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
  }

  if (filters.dateFrom) query = query.gte('transaction_time', filters.dateFrom)
  if (filters.dateTo) query = query.lte('transaction_time', filters.dateTo)
  if (filters.status) query = query.eq('display_status', filters.status.toUpperCase())
  if (filters.search) query = query.ilike('txn_id', `%${filters.search}%`)

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

async function fetchBBPSTransactions(supabase: any, user: any, downline: DownlineInfo, filters: FetchFilters) {
  let query = supabase
    .from('bbps_transactions')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (user.role === 'retailer') {
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
  }

  if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom)
  if (filters.dateTo) query = query.lte('created_at', filters.dateTo)
  if (filters.status) query = query.eq('status', filters.status.toLowerCase())
  if (filters.search) query = query.ilike('transaction_id', `%${filters.search}%`)

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

  return { data: normalized, count: count || 0 }
}

async function fetchAEPSTransactions(supabase: any, user: any, downline: DownlineInfo, filters: FetchFilters) {
  let query = supabase
    .from('aeps_transactions')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (user.role === 'retailer') {
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
  }

  if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom)
  if (filters.dateTo) query = query.lte('created_at', filters.dateTo)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.search) query = query.ilike('id', `%${filters.search}%`)

  query = query.range(filters.offset, filters.offset + filters.limit - 1)

  const { data, count, error } = await query
  if (error) {
    console.error('[AEPS fetch error]', error)
    return { data: [], count: 0 }
  }

  const normalized: NormalizedTransaction[] = (data || []).map((tx: any) => ({
    id: tx.id,
    service_type: 'AEPS',
    transaction_id: tx.id,
    tid: null,
    amount: tx.amount || 0,
    status: tx.status || 'pending',
    commission: tx.commission_amount || 0,
    mdr: 0,
    mdr_rate: 0,
    settlement_type: '-',
    scheme_name: '-',
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
  }))

  return { data: normalized, count: count || 0 }
}

async function fetchSettlementTransactions(supabase: any, user: any, downline: DownlineInfo, filters: FetchFilters) {
  let allResults: NormalizedTransaction[] = []
  let totalCount = 0

  // 1. Query `settlements` table (wallet-to-bank settlements)
  try {
    let sQuery = supabase
      .from('settlements')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (user.role === 'retailer') {
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

    if (user.role === 'retailer') {
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
    new Date(r.created_at).toLocaleString('en-IN'),
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
    `Generated: ${new Date().toLocaleString('en-IN')}`,
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
// EXPORT - PDF (HTML-based)
// ============================================================================

function generatePDF(results: NormalizedTransaction[], summary: any, dateFrom: string | null, dateTo: string | null, service: string, user: any) {
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
    <p>Generated on ${new Date().toLocaleString('en-IN')} | User: ${user.name || user.email} (${user.role})</p>
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
        <td>${new Date(r.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
        <td><span class="badge badge-${r.service_type.toLowerCase()}">${r.service_type}</span></td>
        <td style="font-family: monospace; font-size: 9px;">${r.transaction_id.length > 16 ? r.transaction_id.slice(0, 16) + '...' : r.transaction_id}${r.tid ? '<br/>TID: ' + r.tid : ''}</td>
        <td class="amount">₹${r.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
        <td class="${['success', 'captured', 'SUCCESS', 'CAPTURED'].includes(r.status) ? 'status-success' : ['failed', 'FAILED'].includes(r.status) ? 'status-failed' : 'status-pending'}">${r.status}</td>
        <td class="amount">₹${r.commission.toFixed(2)}</td>
        <td class="amount">₹${r.mdr.toFixed(2)}</td>
        <td>${r.settlement_type}</td>
        <td>${r.scheme_name}</td>
        <td>${r.retailer_name || '-'}</td>
        <td style="font-family: monospace; font-size: 8px;">${r.retailer_id || '-'}</td>
        <td>${r.distributor_name || '-'}</td>
        <td style="font-family: monospace; font-size: 8px;">${r.distributor_id || '-'}</td>
        <td>${r.md_name || '-'}</td>
        <td style="font-family: monospace; font-size: 8px;">${r.master_distributor_id || '-'}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="footer">
    <p>This is a system-generated report. &copy; ${new Date().getFullYear()} Same Day Solution</p>
  </div>
</body>
</html>`

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="service_transaction_report_${Date.now()}.html"`,
    },
  })
}
