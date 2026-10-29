import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { authorizeSubPartner } from '@/lib/partner-access'
import { createClient } from '@supabase/supabase-js'
import { generateCSVResponse, generateExcelResponse, generatePDFResponse, type ReportColumn } from '@/lib/reports/generator'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GST_RATE = 0.18

function sanitize(v: string) { return v.replace(/[,()\\*%]/g, '').trim() }

// ── Scope helpers (same pattern as payout-report) ──────────────────────────

async function resolveDownlineRetailers(supabase: any, user: any): Promise<string[]> {
  if (user.role === 'admin' || user.role === 'finance_executive') return []

  if (user.role === 'master_distributor' && user.partner_id) {
    const { data: dists } = await supabase.from('distributors').select('partner_id').eq('master_distributor_id', user.partner_id)
    const distIds = (dists || []).map((d: any) => d.partner_id)
    const orParts = [`master_distributor_id.eq.${user.partner_id}`]
    if (distIds.length > 0) orParts.push(`distributor_id.in.(${distIds.join(',')})`)
    const { data: rets } = await supabase.from('retailers').select('partner_id').or(orParts.join(','))
    return (rets || []).map((r: any) => r.partner_id)
  }

  if (user.role === 'distributor' && user.partner_id) {
    const { data: rets } = await supabase.from('retailers').select('partner_id').eq('distributor_id', user.partner_id)
    return (rets || []).map((r: any) => r.partner_id)
  }

  if (user.role === 'retailer' && user.partner_id) return [user.partner_id]

  if (user.role === 'partner' && user.partner_id) {
    const { data: links } = await supabase.from('partner_merchant_links').select('merchant_id').eq('partner_id', user.partner_id).eq('is_active', true)
    return [user.partner_id, ...((links || []).map((l: any) => l.merchant_id).filter(Boolean))]
  }

  return []
}

async function resolveAdminScope(supabase: any, searchParams: URLSearchParams): Promise<string[] | null> {
  const filterUserId = searchParams.get('user_id')?.trim()
  const filterDistributorId = searchParams.get('distributor_id')?.trim()
  const filterMdId = searchParams.get('md_id')?.trim()
  const filterPartnerId = searchParams.get('partner_id')?.trim()

  if (filterPartnerId) {
    const ids = new Set<string>([filterPartnerId])
    const { data: links } = await supabase.from('partner_merchant_links').select('merchant_id').eq('partner_id', filterPartnerId).eq('is_active', true)
    for (const l of links || []) if (l?.merchant_id) ids.add(String(l.merchant_id))
    return Array.from(ids)
  }
  if (filterUserId) return [filterUserId]
  if (filterDistributorId) {
    const { data: rets } = await supabase.from('retailers').select('partner_id').eq('distributor_id', filterDistributorId)
    return [filterDistributorId, ...(rets || []).map((r: any) => r.partner_id)]
  }
  if (filterMdId) {
    const { data: dists } = await supabase.from('distributors').select('partner_id').eq('master_distributor_id', filterMdId)
    const distIds = (dists || []).map((d: any) => d.partner_id)
    const orParts = [`master_distributor_id.eq.${filterMdId}`]
    if (distIds.length > 0) orParts.push(`distributor_id.in.(${distIds.join(',')})`)
    const { data: rets } = await supabase.from('retailers').select('partner_id').or(orParts.join(','))
    return [filterMdId, ...distIds, ...(rets || []).map((r: any) => r.partner_id)]
  }
  return null
}

// ── Main handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    if (!supabaseUrl || !supabaseServiceKey) return NextResponse.json({ error: 'Configuration missing' }, { status: 500 })

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })

    const access = authorizeSubPartner(user, 'reports')
    if (!access.ok) return access.response

    const allowed = ['admin', 'finance_executive', 'master_distributor', 'distributor', 'retailer', 'partner']
    if (!allowed.includes(user.role)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const rawDateFrom = searchParams.get('date_from')
    const rawDateTo = searchParams.get('date_to')
    const dateFrom = rawDateFrom ? (rawDateFrom.includes('T') ? rawDateFrom : `${rawDateFrom}T00:00:00+05:30`) : null
    const dateTo = rawDateTo ? (rawDateTo.includes('T') ? rawDateTo : `${rawDateTo}T23:59:59+05:30`) : null
    const status = searchParams.get('status')
    const search = searchParams.get('search')
    const providerFilter = searchParams.get('provider') // 'default' | 'knteer' | ''
    const rawLimit = parseInt(searchParams.get('limit') || '25', 10)
    const format = searchParams.get('format') || 'json'
    const isExport = ['csv', 'excel', 'pdf'].includes(format)
    const limit = isExport ? Math.min(10000, rawLimit || 10000) : ([10, 25, 100].includes(rawLimit) ? rawLimit : 25)
    const offset = parseInt(searchParams.get('offset') || '0')

    // Determine scope
    let scope: string[] | null
    if (user.role === 'admin' || user.role === 'finance_executive') {
      scope = await resolveAdminScope(supabase, searchParams)
    } else {
      scope = await resolveDownlineRetailers(supabase, user)
    }

    if (Array.isArray(scope) && scope.length === 0) {
      return NextResponse.json({ success: true, data: [], summary: emptySummary(), pagination: emptyPagination(limit, offset) })
    }

    let allRows: any[] = []

    const fetchAll = async (table: string, columns: string, applyFilters: (q: any) => any, mapRow: (tx: any) => any) => {
      const size = 1000
      for (let from = 0; from < 100000; from += size) {
        const q = applyFilters(
          supabase.from(table).select(columns).order('created_at', { ascending: false })
        ).range(from, from + size - 1)
        const { data, error } = await q
        if (error) { console.error(`[Settlement Report] ${table} error:`, error); break }
        if (!data || data.length === 0) break
        allRows = allRows.concat(data.map(mapRow))
        if (data.length < size) break
      }
    }

    // 1. payout_transactions (Default Settlement-1 provider)
    if (!providerFilter || providerFilter === 'default') {
      await fetchAll(
        'payout_transactions',
        'id, created_at, transaction_id, client_ref_id, account_holder_name, account_number, bank_name, ifsc_code, amount, charges, rrn, status, retailer_id',
        (q) => {
          if (scope) q = q.in('retailer_id', scope)
          if (dateFrom) q = q.gte('created_at', dateFrom)
          if (dateTo) q = q.lte('created_at', dateTo)
          if (status) q = q.eq('status', status.toLowerCase())
          if (search) q = q.or(`transaction_id.ilike.%${sanitize(search)}%,client_ref_id.ilike.%${sanitize(search)}%,account_holder_name.ilike.%${sanitize(search)}%,account_number.ilike.%${sanitize(search)}%`)
          return q
        },
        (tx: any) => {
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
            user_type: null as string | null,
            provider: 'Default',
          }
        }
      )
    }

    // 2. knteer_payout_transactions (Knteer Settlement-1 provider)
    if (!providerFilter || providerFilter === 'knteer') {
      await fetchAll(
        'knteer_payout_transactions',
        'id, created_at, partner_trans_id, knteer_trans_id, account_holder_name, account_number, ifsc_code, bank_name, amount, charges, total_debit, actual_wallet_debit, utr, status, retailer_id, distributor_id, md_id, user_role, company_earning, distributor_commission, md_commission, retailer_commission_earned',
        (q) => {
          if (scope) q = q.in('retailer_id', scope)
          if (dateFrom) q = q.gte('created_at', dateFrom)
          if (dateTo) q = q.lte('created_at', dateTo)
          if (status) q = q.eq('status', status.toUpperCase())
          if (search) q = q.or(`partner_trans_id.ilike.%${sanitize(search)}%,knteer_trans_id.ilike.%${sanitize(search)}%,account_holder_name.ilike.%${sanitize(search)}%,account_number.ilike.%${sanitize(search)}%`)
          return q
        },
        (tx: any) => {
          const charge = Number(tx.charges) || 0
          const gst = Math.round(charge * GST_RATE * 100) / 100
          return {
            date: tx.created_at,
            transaction_id: tx.partner_trans_id || tx.knteer_trans_id || tx.id,
            beneficiary_name: tx.account_holder_name || '-',
            beneficiary_account: tx.account_number || '-',
            bank_name: tx.bank_name || '-',
            ifsc_code: tx.ifsc_code || '-',
            amount: Number(tx.amount) || 0,
            charge,
            gst,
            total_debit: Number(tx.total_debit) || Number(tx.actual_wallet_debit) || ((Number(tx.amount) || 0) + charge + gst),
            reference_number: tx.utr || tx.knteer_trans_id || '-',
            status: tx.status || 'PENDING',
            retailer_id: tx.retailer_id,
            retailer_name: null as string | null,
            user_type: roleToType(tx.user_role),
            provider: 'Knteer',
            company_earning: Number(tx.company_earning) || null,
            dt_commission: Number(tx.distributor_commission) || null,
            md_commission: Number(tx.md_commission) || null,
          }
        }
      )
    }

    // Sort by date desc
    allRows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    // Enrich user names + types (UUID-safe — partners.id is uuid, retailer/dist/md use text partner_id)
    const allUserIds = Array.from(new Set(allRows.map(r => r.retailer_id).filter(Boolean)))
    if (allUserIds.length > 0) {
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      const uuidIds = allUserIds.filter((id: string) => uuidRe.test(id))

      const nameMap = new Map<string, { name: string; type: string }>()
      const [retRes, distRes, mdRes] = await Promise.all([
        supabase.from('retailers').select('partner_id, name').in('partner_id', allUserIds),
        supabase.from('distributors').select('partner_id, name').in('partner_id', allUserIds),
        supabase.from('master_distributors').select('partner_id, name').in('partner_id', allUserIds),
      ])
      for (const r of retRes.data || []) nameMap.set(r.partner_id, { name: r.name, type: 'RT' })
      for (const d of distRes.data || []) nameMap.set(d.partner_id, { name: d.name, type: 'DT' })
      for (const m of mdRes.data || []) nameMap.set(m.partner_id, { name: m.name, type: 'MD' })
      if (uuidIds.length > 0) {
        const { data: partners } = await supabase.from('partners').select('id, name, business_name, email').in('id', uuidIds)
        for (const p of partners || []) {
          const n = p.name || p.business_name || p.email
          if (n) nameMap.set(p.id, { name: n, type: 'Partner' })
        }
      }
      allRows.forEach(r => {
        if (r.retailer_id && nameMap.has(r.retailer_id)) {
          const info = nameMap.get(r.retailer_id)!
          r.retailer_name = info.name
          r.user_type = info.type  // confirmed type overrides DB user_role fallback
        }
      })
    }

    // Status normalise to lowercase
    const normalStatus = (s: string) => s?.toLowerCase() ?? 'pending'
    const successStatuses = ['success']
    const failedStatuses = ['failed', 'failure', 'reversed']
    const pendingStatuses = ['pending', 'processing', 'initiated']

    // Summary with by_status breakdown (for clickable status cards)
    const calcBucket = (rows: any[]) => ({
      count: rows.length,
      amount: rows.reduce((s, r) => s + r.amount, 0),
      charges: rows.reduce((s, r) => s + r.charge, 0),
      gst: rows.reduce((s, r) => s + r.gst, 0),
      total_debit: rows.reduce((s, r) => s + r.total_debit, 0),
    })

    const successRows = allRows.filter(r => successStatuses.includes(normalStatus(r.status)))
    const failedRows = allRows.filter(r => failedStatuses.includes(normalStatus(r.status)))
    const pendingRows = allRows.filter(r => pendingStatuses.includes(normalStatus(r.status)))

    const summary = {
      total_transactions: allRows.length,
      total_amount: allRows.reduce((s, r) => s + r.amount, 0),
      total_charges: allRows.reduce((s, r) => s + r.charge, 0),
      total_gst: allRows.reduce((s, r) => s + r.gst, 0),
      total_debit: allRows.reduce((s, r) => s + r.total_debit, 0),
      success_count: successRows.length,
      failed_count: failedRows.length,
      pending_count: pendingRows.length,
      by_status: {
        success: calcBucket(successRows),
        failed: calcBucket(failedRows),
        pending: calcBucket(pendingRows),
      },
    }

    const columns: ReportColumn[] = [
      { header: 'Date', key: 'date', type: 'date' },
      { header: 'Transaction ID', key: 'transaction_id' },
      { header: 'Provider', key: 'provider' },
      { header: 'User Name', key: 'retailer_name' },
      { header: 'User Type', key: 'user_type' },
      { header: 'Beneficiary Name', key: 'beneficiary_name' },
      { header: 'Account No.', key: 'beneficiary_account' },
      { header: 'Bank', key: 'bank_name' },
      { header: 'IFSC', key: 'ifsc_code' },
      { header: 'Amount (₹)', key: 'amount', type: 'currency' },
      { header: 'Charge (₹)', key: 'charge', type: 'currency' },
      { header: 'GST (₹)', key: 'gst', type: 'currency' },
      { header: 'Total Debit (₹)', key: 'total_debit', type: 'currency' },
      { header: 'UTR / Ref No.', key: 'reference_number' },
      { header: 'Status', key: 'status' },
    ]

    const fn = `settlement_1_report_${Date.now()}`
    const rptMeta = {
      title: 'Settlement-1 Transaction Report',
      dateRange: { from: dateFrom, to: dateTo },
      summaryCards: [
        { label: 'Total Transactions', value: String(summary.total_transactions) },
        { label: 'Total Amount', value: `₹${summary.total_amount.toFixed(2)}` },
        { label: 'Total Charges', value: `₹${summary.total_charges.toFixed(2)}` },
        { label: 'Success / Failed / Pending', value: `${summary.success_count} / ${summary.failed_count} / ${summary.pending_count}` },
      ],
    }

    if (format === 'csv') return generateCSVResponse(allRows, columns, fn, rptMeta)
    if (format === 'excel') return generateExcelResponse(allRows, columns, fn, 'Settlement-1 Transactions')
    if (format === 'pdf') return await generatePDFResponse(allRows, columns, fn, rptMeta, { accentColor: '#6366F1' })

    const total = allRows.length
    const rows = allRows.slice(offset, offset + limit)

    return NextResponse.json({
      success: true,
      data: rows,
      summary,
      pagination: { total, limit, offset, page: Math.floor(offset / limit) + 1, totalPages: Math.ceil(total / limit) },
    })
  } catch (error: any) {
    console.error('[Settlement Report] Error:', error)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}

function roleToType(role?: string): string | null {
  if (!role) return null
  const r = role.toLowerCase()
  if (r === 'retailer') return 'RT'
  if (r === 'distributor') return 'DT'
  if (r === 'master_distributor') return 'MD'
  if (r === 'partner') return 'Partner'
  return null
}

function emptySummary() {
  return {
    total_transactions: 0, total_amount: 0, total_charges: 0, total_gst: 0, total_debit: 0,
    success_count: 0, failed_count: 0, pending_count: 0,
    by_status: {
      success: { count: 0, amount: 0, charges: 0, gst: 0, total_debit: 0 },
      failed: { count: 0, amount: 0, charges: 0, gst: 0, total_debit: 0 },
      pending: { count: 0, amount: 0, charges: 0, gst: 0, total_debit: 0 },
    },
  }
}

function emptyPagination(limit: number, offset: number) {
  return { total: 0, limit, offset, page: 1, totalPages: 0 }
}
