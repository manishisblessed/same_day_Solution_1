import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { authorizeSubPartner } from '@/lib/partner-access'
import { createClient } from '@supabase/supabase-js'
import { generateCSVResponse, generateExcelResponse, generatePDFResponse, type ReportColumn } from '@/lib/reports/generator'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sanitize(value: string): string {
  return value.replace(/[,()\\*%]/g, '').trim()
}


const GST_RATE = 0.18

interface DownlineInfo {
  retailerIds: string[]
  distributorIds: string[]
}

async function resolveDownline(supabase: any, user: any): Promise<DownlineInfo> {
  const info: DownlineInfo = { retailerIds: [], distributorIds: [] }

  if (user.role === 'admin' || user.role === 'finance_executive') return info

  if (user.role === 'master_distributor' && user.partner_id) {
    const { data: dists } = await supabase
      .from('distributors')
      .select('partner_id')
      .eq('master_distributor_id', user.partner_id)
    info.distributorIds = (dists || []).map((d: any) => d.partner_id)
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

async function resolvePartnerScope(supabase: any, partnerId: string): Promise<string[]> {
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
  } catch {}
  return Array.from(ids)
}

async function narrowDownline(
  supabase: any,
  user: any,
  downline: DownlineInfo,
  searchParams: URLSearchParams
): Promise<string[] | null> {
  if (user.role === 'distributor') {
    const fUser = searchParams.get('user_id')?.trim()
    if (fUser && downline.retailerIds.includes(fUser)) return [fUser]
    return downline.retailerIds
  }
  if (user.role === 'master_distributor') {
    const fUser = searchParams.get('user_id')?.trim()
    const fDist = searchParams.get('distributor_id')?.trim()
    if (fUser && downline.retailerIds.includes(fUser)) return [fUser]
    if (fDist) {
      const { data: rets } = await supabase.from('retailers').select('partner_id').eq('distributor_id', fDist)
      const ids = (rets || []).map((r: any) => r.partner_id).filter((id: string) => downline.retailerIds.includes(id))
      return ids.length ? ids : ['__none__']
    }
    return downline.retailerIds
  }
  return null
}

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }

    const access = authorizeSubPartner(user, 'reports')
    if (!access.ok) return access.response

    const allowedRoles = ['admin', 'finance_executive', 'master_distributor', 'distributor', 'retailer', 'partner']
    if (!allowedRoles.includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const rawDateFrom = searchParams.get('date_from')
    const rawDateTo = searchParams.get('date_to')
    const dateFrom = rawDateFrom ? (rawDateFrom.includes('T') ? rawDateFrom : `${rawDateFrom}T00:00:00+05:30`) : null
    const dateTo = rawDateTo ? (rawDateTo.includes('T') ? rawDateTo : `${rawDateTo}T23:59:59+05:30`) : null
    const status = searchParams.get('status')
    const search = searchParams.get('search')
    const rawLimit = parseInt(searchParams.get('limit') || '25', 10)
    const format = searchParams.get('format') || 'json'
    const isExport = ['csv', 'excel'].includes(format)
    const limit = isExport ? Math.min(10000, Math.max(1, rawLimit || 10000)) : [10, 25, 100].includes(rawLimit) ? rawLimit : 25
    const offset = parseInt(searchParams.get('offset') || '0')

    // Admin targeted filters
    let adminUserIds: string[] | null = null
    if (user.role === 'admin' || user.role === 'finance_executive') {
      const filterUserId = searchParams.get('user_id')?.trim()
      const filterDistributorId = searchParams.get('distributor_id')?.trim()
      const filterMdId = searchParams.get('md_id')?.trim()
      const filterPartnerId = searchParams.get('partner_id')?.trim()

      if (filterPartnerId) {
        // Partner settlements are stored with retailer_id = partner uuid
        adminUserIds = await resolvePartnerScope(supabase, filterPartnerId)
      } else if (filterUserId) {
        adminUserIds = [filterUserId]
      } else if (filterDistributorId) {
        const { data: rets } = await supabase.from('retailers').select('partner_id').eq('distributor_id', filterDistributorId)
        adminUserIds = [filterDistributorId, ...(rets || []).map((r: any) => r.partner_id)]
      } else if (filterMdId) {
        const { data: dists } = await supabase.from('distributors').select('partner_id').eq('master_distributor_id', filterMdId)
        const distIds = (dists || []).map((d: any) => d.partner_id)
        const orParts = [`master_distributor_id.eq.${filterMdId}`]
        if (distIds.length > 0) orParts.push(`distributor_id.in.(${distIds.join(',')})`)
        const { data: rets } = await supabase.from('retailers').select('partner_id').or(orParts.join(','))
        adminUserIds = [filterMdId, ...distIds, ...(rets || []).map((r: any) => r.partner_id)]
      }
    }

    const downline = await resolveDownline(supabase, user)
    const effectiveDownline = await narrowDownline(supabase, user, downline, searchParams)
    const partnerScope = user.role === 'partner' && user.partner_id
      ? await resolvePartnerScope(supabase, user.partner_id)
      : null

    // Determine user scope for filtering
    function getUserScope(): string[] | null {
      if (user.role === 'partner') return partnerScope?.length ? partnerScope : []
      if (user.role === 'retailer') return user.partner_id ? [user.partner_id] : []
      if (user.role === 'distributor' || user.role === 'master_distributor') return (effectiveDownline && effectiveDownline.length > 0) ? effectiveDownline : []
      if (adminUserIds) return adminUserIds
      return null // admin/finance with no filter — full access
    }
    const scope = getUserScope()
    if (Array.isArray(scope) && scope.length === 0) {
      return NextResponse.json({ success: true, data: [], summary: emptyStats(), pagination: emptyPagination(limit, offset) })
    }

    let allRows: any[] = []

    // Chunked fetch helper — pulls the entire filtered set from a table
    const fetchAll = async (table: string, applyFilters: (q: any) => any, mapRow: (tx: any) => any) => {
      const size = 1000
      for (let from = 0; from < 100000; from += size) {
        const q = applyFilters(
          supabase.from(table).select('*').order('created_at', { ascending: false })
        ).range(from, from + size - 1)
        const { data, error } = await q
        if (error) { console.error(`[Payout Report] ${table} error:`, error); break }
        if (!data || data.length === 0) break
        allRows = allRows.concat(data.map(mapRow))
        if (data.length < size) break
      }
    }

    // 1. payout_transactions (Settlement-1)
    await fetchAll('payout_transactions', (q) => {
      if (scope) q = q.in('retailer_id', scope)
      if (dateFrom) q = q.gte('created_at', dateFrom)
      if (dateTo) q = q.lte('created_at', dateTo)
      if (status) q = q.eq('status', status.toLowerCase())
      if (search) q = q.or(`transaction_id.ilike.%${sanitize(search)}%,client_ref_id.ilike.%${sanitize(search)}%`)
      return q
    }, (tx: any) => {
      const charge = Number(tx.charges) || 0
      const gst = Math.round(charge * GST_RATE * 100) / 100
      return {
        date: tx.created_at,
        transaction_id: tx.transaction_id || tx.client_ref_id || tx.id,
        beneficiary_name: tx.account_holder_name || '-',
        beneficiary_account: tx.account_number || '-',
        bank_name: tx.bank_name || '-',
        ifsc_code: tx.ifsc_code || '-',
        amount: Number(tx.amount) || 0,
        charge,
        gst,
        total_debit: (Number(tx.amount) || 0) + charge + gst,
        reference_number: tx.rrn || tx.client_ref_id || '-',
        status: tx.status || 'pending',
        retailer_id: tx.retailer_id,
        retailer_name: null as string | null,
        source: 'Settlement-1',
      }
    })

    // 2. shadval_settlement (Settlement-2)
    await fetchAll('shadval_settlement', (q) => {
      if (scope) q = q.in('retailer_id', scope)
      if (dateFrom) q = q.gte('created_at', dateFrom)
      if (dateTo) q = q.lte('created_at', dateTo)
      if (status) q = q.eq('status', status.toUpperCase())
      if (search) q = q.or(`reference_id.ilike.%${sanitize(search)}%,order_id.ilike.%${sanitize(search)}%`)
      return q
    }, (tx: any) => {
      const charge = Number(tx.charges) || 0
      const gst = Math.round(charge * GST_RATE * 100) / 100
      return {
        date: tx.created_at,
        transaction_id: tx.reference_id || tx.order_id || tx.id,
        beneficiary_name: tx.account_holder_name || tx.contact_name || '-',
        beneficiary_account: tx.account_number || '-',
        bank_name: '-',
        ifsc_code: tx.ifsc_code || '-',
        amount: Number(tx.amount) || 0,
        charge,
        gst,
        total_debit: Number(tx.total_debit) || ((Number(tx.amount) || 0) + charge + gst),
        reference_number: tx.utr || tx.reference_id || '-',
        status: tx.status || 'PENDING',
        retailer_id: tx.retailer_id,
        retailer_name: null as string | null,
        source: 'Settlement-2',
      }
    })

    // Sort combined results by date descending
    allRows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    // Enrich retailer names
    const retailerIds = Array.from(new Set(allRows.map(r => r.retailer_id).filter(Boolean)))
    if (retailerIds.length > 0) {
      const { data: retailers } = await supabase.from('retailers').select('partner_id, name').in('partner_id', retailerIds)
      const nameMap = new Map((retailers || []).map((r: any) => [r.partner_id, r.name]))
      allRows.forEach(r => { if (r.retailer_id) r.retailer_name = nameMap.get(r.retailer_id) || null })
    }

    // Summary over the FULL filtered set
    const summary = {
      total_transactions: allRows.length,
      total_amount: allRows.reduce((s, r) => s + r.amount, 0),
      total_charges: allRows.reduce((s, r) => s + r.charge, 0),
      total_gst: allRows.reduce((s, r) => s + r.gst, 0),
      total_debit: allRows.reduce((s, r) => s + r.total_debit, 0),
      success_count: allRows.filter(r => ['success', 'SUCCESS'].includes(r.status)).length,
      failed_count: allRows.filter(r => ['failed', 'FAILED'].includes(r.status)).length,
      pending_count: allRows.filter(r => ['pending', 'processing', 'PENDING'].includes(r.status)).length,
    }

    const payoutColumns: ReportColumn[] = [
      { header: 'Date', key: 'date', type: 'date' },
      { header: 'Transaction ID', key: 'transaction_id' },
      { header: 'Beneficiary Name', key: 'beneficiary_name' },
      { header: 'Account No.', key: 'beneficiary_account' },
      { header: 'Bank Name', key: 'bank_name' },
      { header: 'IFSC Code', key: 'ifsc_code' },
      { header: 'Amount (₹)', key: 'amount', type: 'currency' },
      { header: 'Charge (₹)', key: 'charge', type: 'currency' },
      { header: 'GST (₹)', key: 'gst', type: 'currency' },
      { header: 'Total Debit (₹)', key: 'total_debit', type: 'currency' },
      { header: 'Reference No.', key: 'reference_number' },
      { header: 'Status', key: 'status' },
    ]
    const fn = `settlement_report_${Date.now()}`
    const rptMeta = {
      title: 'Settlement / Payout Transaction Report',
      dateRange: { from: dateFrom, to: dateTo },
      summaryCards: [
        { label: 'Total Transactions', value: String(summary.total_transactions) },
        { label: 'Total Amount', value: `₹${summary.total_amount.toFixed(2)}` },
        { label: 'Total Charges', value: `₹${summary.total_charges.toFixed(2)}` },
        { label: 'Success / Failed / Pending', value: `${summary.success_count} / ${summary.failed_count} / ${summary.pending_count}` },
      ],
    }

    if (format === 'csv') return generateCSVResponse(allRows, payoutColumns, fn, rptMeta)
    if (format === 'excel') return generateExcelResponse(allRows, payoutColumns, fn, 'Payout Transactions')
    if (format === 'pdf') return await generatePDFResponse(allRows, payoutColumns, fn, rptMeta, { accentColor: '#6366F1' })

    const total = allRows.length
    const rows = allRows.slice(offset, offset + limit)

    return NextResponse.json({
      success: true,
      data: rows,
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
    console.error('[Payout Report] Error:', error)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}

function emptyStats() {
  return { total_transactions: 0, total_amount: 0, total_charges: 0, total_gst: 0, total_debit: 0, success_count: 0, failed_count: 0, pending_count: 0 }
}

function emptyPagination(limit: number, offset: number) {
  return { total: 0, limit, offset, page: 1, totalPages: 0 }
}

