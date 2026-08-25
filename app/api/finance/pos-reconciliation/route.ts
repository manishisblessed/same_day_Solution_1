import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { financeHasTab } from '@/lib/auth-roles'
import { calculateMDR, calculatePartnerMDR } from '@/lib/mdr-scheme/settlement.service'
import {
  generateCSVResponse,
  generateExcelResponse,
  generatePDFResponse,
  type ReportColumn,
} from '@/lib/reports/generator'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Upper bound on rows scanned for a single reconciliation request. */
const MAX_ROWS = 100000
const PAGE_SIZE = 1000

function sanitize(value: string): string {
  return value.replace(/[,()\\*%]/g, '').trim()
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function getCompanyName(merchantName: string | null, slug: string | null): string {
  if (merchantName) return merchantName
  switch (slug) {
    case 'ashvam': return 'ASHVAM LEARNING PRIVATE LIMITED'
    case 'teachway': return 'Teachway Education Private Limited'
    case 'newscenaric': return 'New Scenaric Travels'
    case 'lagoon': return 'LAGOON CRAFT LABS SOLUTIONS PRIVATE LIMITED'
    case 'avika': return 'Avika Departmental Private Limited'
    default: return 'ASHVAM LEARNING PRIVATE LIMITED'
  }
}

/** T0 for InstaCash/Pulse-Pay txns, otherwise standard T1. */
function settlementTypeOf(row: any): 'T0' | 'T1' {
  if (row.settlement_mode === 'INSTACASH' || row.settlement_type === 'T0') return 'T0'
  return 'T1'
}

/** The settlement owner of the txn: partner takes precedence, else retailer. */
function holderOf(row: any): { leg: 'partner' | 'retailer'; id: string } | null {
  if (row.partner_id) return { leg: 'partner', id: row.partner_id }
  if (row.retailer_id) return { leg: 'retailer', id: row.retailer_id }
  return null
}

/** Fallback to the rate stored on the row when a live scheme lookup yields nothing. */
function storedRate(row: any): number | null {
  const amount = Number(row.amount) || 0
  if (row.partner_id) {
    if (row.partner_mdr_rate != null) return Number(row.partner_mdr_rate)
    if (row.partner_mdr_amount != null && amount > 0) return (Number(row.partner_mdr_amount) / amount) * 100
    return null
  }
  if (row.mdr_rate != null) return Number(row.mdr_rate)
  if (row.mdr_amount != null && amount > 0) return (Number(row.mdr_amount) / amount) * 100
  return null
}

function rateKey(row: any): string | null {
  const holder = holderOf(row)
  if (!holder) return null
  return [
    holder.leg,
    holder.id,
    row.payment_mode || 'CARD',
    row.card_type || '',
    row.card_brand || '',
    row.card_classification || '',
    settlementTypeOf(row),
    row.merchant_slug || '',
  ].join('|')
}

/**
 * Resolve the live MDR percentage from the assigned scheme for one txn's slab.
 * Retailer-held txns use the retailer scheme; partner-held txns use the partner scheme.
 */
async function resolveLiveRate(row: any): Promise<number | null> {
  const holder = holderOf(row)
  if (!holder) return null
  const settlementType = settlementTypeOf(row)
  try {
    if (holder.leg === 'partner') {
      const r = await calculatePartnerMDR(
        holder.id,
        100,
        settlementType,
        row.payment_mode || 'CARD',
        row.card_type || undefined,
        row.card_brand || undefined,
        row.merchant_slug || null
      )
      if (r.success && r.partner_mdr != null) return Number(r.partner_mdr)
    } else {
      const r = await calculateMDR({
        amount: 100,
        settlement_type: settlementType,
        mode: (row.payment_mode || 'CARD') as any,
        card_type: (row.card_type || null) as any,
        brand_type: row.card_brand || null,
        card_classification: row.card_classification || null,
        merchant_slug: row.merchant_slug || null,
        retailer_id: holder.id,
      })
      if (r.success && r.result) return Number(r.result.retailer_mdr)
    }
  } catch (e) {
    console.warn('[pos-reconciliation] live MDR resolve failed:', (e as any)?.message)
  }
  return null
}

async function fetchNameMap(
  supabase: SupabaseClient,
  table: string,
  idField: string,
  ids: string[]
): Promise<Record<string, string>> {
  const map: Record<string, string> = {}
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500)
    const { data } = await supabase.from(table).select(`${idField}, name, business_name`).in(idField, batch)
    for (const row of data || []) {
      const key = (row as any)[idField]
      if (key) map[key] = (row as any).name || (row as any).business_name || ''
    }
  }
  return map
}

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    const isAdmin = user.role === 'admin'
    const isFinance = user.role === 'finance_executive' && financeHasTab(user, 'reconciliation')
    if (!isAdmin && !isFinance) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const rawDateFrom = searchParams.get('date_from')
    const rawDateTo = searchParams.get('date_to')
    const dateFrom = rawDateFrom ? (rawDateFrom.includes('T') ? rawDateFrom : `${rawDateFrom}T00:00:00+05:30`) : null
    const dateTo = rawDateTo ? (rawDateTo.includes('T') ? rawDateTo : `${rawDateTo}T23:59:59+05:30`) : null
    const status = searchParams.get('status')
    const paymentMode = searchParams.get('payment_mode')
    const cardBrand = searchParams.get('card_brand')
    const merchantSlug = searchParams.get('merchant_slug')
    const search = searchParams.get('search')
    const format = searchParams.get('format') || 'json'
    const isExport = ['csv', 'excel', 'pdf'].includes(format)
    const limit = [10, 25, 50, 100].includes(parseInt(searchParams.get('limit') || '50', 10))
      ? parseInt(searchParams.get('limit') || '50', 10)
      : 50
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10))

    const applyFilters = (q: any) => {
      if (merchantSlug && merchantSlug !== 'all') {
        if (merchantSlug === 'ashvam') q = q.or('merchant_slug.eq.ashvam,merchant_slug.is.null')
        else q = q.eq('merchant_slug', merchantSlug)
      }
      if (dateFrom) q = q.gte('transaction_time', dateFrom)
      if (dateTo) q = q.lte('transaction_time', dateTo)
      if (paymentMode && paymentMode !== 'all') q = q.eq('payment_mode', paymentMode.toUpperCase())
      if (cardBrand && cardBrand !== 'all') q = q.eq('card_brand', cardBrand.toUpperCase())
      if (status && ['CAPTURED', 'FAILED', 'PENDING'].includes(status.toUpperCase())) {
        const displayStatus = status.toUpperCase() === 'CAPTURED' ? 'SUCCESS' : status.toUpperCase()
        q = q.eq('display_status', displayStatus)
      } else {
        // Default: exclude failed + reversed from reconciliation.
        q = q.not('display_status', 'in', '(FAILED,VOIDED,REFUNDED,CANCELLED)')
      }
      if (search && search.trim()) {
        const s = sanitize(search.trim())
        q = q.or(
          `txn_id.ilike.%${s}%,rrn.ilike.%${s}%,tid.ilike.%${s}%,mid_code.ilike.%${s}%,customer_name.ilike.%${s}%,username.ilike.%${s}%,card_number.ilike.%${s}%`
        )
      }
      return q
    }

    // Fetch the full filtered set so totals and export cover every row.
    const allTx: any[] = []
    for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
      const { data: chunk, error } = await applyFilters(
        supabase.from('razorpay_pos_transactions').select('*').order('transaction_time', { ascending: false, nullsFirst: false })
      ).range(from, from + PAGE_SIZE - 1)
      if (error) {
        console.error('[pos-reconciliation] query error:', error)
        return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 })
      }
      if (!chunk || chunk.length === 0) break
      allTx.push(...chunk)
      if (chunk.length < PAGE_SIZE) break
    }

    // Warm the live-rate cache once per unique scheme slab (bounded DB calls).
    const rateCache = new Map<string, number | null>()
    const repByKey = new Map<string, any>()
    for (const tx of allTx) {
      const key = rateKey(tx)
      if (key && !repByKey.has(key)) repByKey.set(key, tx)
    }
    for (const [key, tx] of repByKey) {
      rateCache.set(key, await resolveLiveRate(tx))
    }

    const finalRate = (row: any): number | null => {
      const key = rateKey(row)
      const live = key ? rateCache.get(key) : null
      if (live != null) return live
      return storedRate(row)
    }

    // Resolve holder display names in bulk from the stamped settlement ids.
    const partnerIds = new Set<string>()
    const retailerIds = new Set<string>()
    const distributorIds = new Set<string>()
    const mdIds = new Set<string>()
    for (const tx of allTx) {
      if (tx.partner_id) partnerIds.add(tx.partner_id)
      else if (tx.retailer_id) retailerIds.add(tx.retailer_id)
      else if (tx.distributor_id) distributorIds.add(tx.distributor_id)
      else if (tx.master_distributor_id) mdIds.add(tx.master_distributor_id)
    }
    const [partnerMap, retailerMap, distributorMap, mdMap] = await Promise.all([
      partnerIds.size ? fetchNameMap(supabase, 'partners', 'id', Array.from(partnerIds)) : Promise.resolve({}),
      retailerIds.size ? fetchNameMap(supabase, 'retailers', 'partner_id', Array.from(retailerIds)) : Promise.resolve({}),
      distributorIds.size ? fetchNameMap(supabase, 'distributors', 'partner_id', Array.from(distributorIds)) : Promise.resolve({}),
      mdIds.size ? fetchNameMap(supabase, 'master_distributors', 'partner_id', Array.from(mdIds)) : Promise.resolve({}),
    ])
    const holderName = (tx: any): string => {
      if (tx.partner_id) return partnerMap[tx.partner_id] || ''
      if (tx.retailer_id) return retailerMap[tx.retailer_id] || ''
      if (tx.distributor_id) return distributorMap[tx.distributor_id] || ''
      if (tx.master_distributor_id) return mdMap[tx.master_distributor_id] || ''
      return ''
    }

    const allRows = allTx.map((tx: any) => {
      const amount = Number(tx.amount) || 0
      const rate = finalRate(tx)
      const charges = rate != null ? round2((amount * rate) / 100) : null
      const netPay = charges != null ? round2(amount - charges) : null
      return {
        date: tx.transaction_time || tx.created_at,
        amount,
        mdr_rate: rate,
        charges,
        net_pay: netPay,
        currency: tx.currency || 'INR',
        payment_mode: tx.payment_mode || '',
        consumer_name: tx.customer_name || tx.payer_name || '',
        company_name: getCompanyName(tx.merchant_name, tx.merchant_slug),
        holder_name: holderName(tx),
        tid: tx.tid || '',
        mid: tx.mid_code || '',
        card_number: tx.card_number || '',
        card_brand: tx.card_brand || '',
        card_type: tx.card_type || '',
        rrn: tx.rrn || '',
        auth_code: tx.auth_code || '',
        device_serial: tx.device_serial || '',
      }
    })

    const summary = {
      total_transactions: allRows.length,
      total_amount: round2(allRows.reduce((s, r) => s + r.amount, 0)),
      total_charges: round2(allRows.reduce((s, r) => s + (r.charges || 0), 0)),
      total_net: round2(allRows.reduce((s, r) => s + (r.net_pay ?? r.amount), 0)),
      unpriced: allRows.filter((r) => r.mdr_rate == null).length,
    }

    const columns: ReportColumn[] = [
      { header: 'Date & Time', key: 'date', type: 'date' },
      { header: 'Amount (₹)', key: 'amount', type: 'currency' },
      { header: 'MDR (%)', key: 'mdr_rate', type: 'number' },
      { header: 'Charges (₹)', key: 'charges', type: 'currency' },
      { header: 'Net Pay (₹)', key: 'net_pay', type: 'currency' },
      { header: 'Currency', key: 'currency' },
      { header: 'Payment Mode', key: 'payment_mode' },
      { header: 'Consumer Name', key: 'consumer_name' },
      { header: 'Company Name', key: 'company_name' },
      { header: 'Partner/Retailer Name', key: 'holder_name' },
      { header: 'TID', key: 'tid' },
      { header: 'MID', key: 'mid' },
      { header: 'Card Number', key: 'card_number' },
      { header: 'Card Brand', key: 'card_brand' },
      { header: 'Card Type', key: 'card_type' },
      { header: 'RRN', key: 'rrn' },
      { header: 'Auth Code', key: 'auth_code' },
      { header: 'Device Serial', key: 'device_serial' },
    ]

    if (isExport) {
      const fn = `pos_reconciliation_${Date.now()}`
      const meta = {
        title: 'POS Reconciliation Report',
        dateRange: { from: dateFrom, to: dateTo },
        summaryCards: [
          { label: 'Total Transactions', value: String(summary.total_transactions) },
          { label: 'Gross Amount', value: `₹${summary.total_amount.toFixed(2)}` },
          { label: 'Total Charges (MDR)', value: `₹${summary.total_charges.toFixed(2)}` },
          { label: 'Total Net Pay', value: `₹${summary.total_net.toFixed(2)}` },
        ],
      }
      if (format === 'csv') return generateCSVResponse(allRows, columns, fn, meta)
      if (format === 'excel') return generateExcelResponse(allRows, columns, fn, 'POS Reconciliation')
      if (format === 'pdf') return await generatePDFResponse(allRows, columns, fn, meta, { landscape: true, accentColor: '#059669' })
    }

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
      },
    })
  } catch (e: any) {
    console.error('[pos-reconciliation] error:', e)
    return NextResponse.json({ error: 'Failed to generate reconciliation report' }, { status: 500 })
  }
}
