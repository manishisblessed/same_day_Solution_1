import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { generateCSVResponse, generateExcelResponse, generatePDFResponse, type ReportColumn } from '@/lib/reports/generator'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sanitize(value: string): string {
  return value.replace(/[,()\\*%]/g, '').trim()
}

const GST_RATE = 0.18

type ProviderCode =
  | 'BBPS_1'
  | 'BBPS_Pay2New'
  | 'BBPS_Pay2New_Credit_Card'
  | 'BBPS_Rechargekit_Credit_Card'

type ProviderFilter = '' | 'bbps' | 'credit_card' | 'pay2new' | 'rechargekit'

function matchesProviderFilter(source: ProviderCode, filter: ProviderFilter): boolean {
  if (!filter) return true
  switch (filter) {
    case 'bbps':
      return source === 'BBPS_1' || source === 'BBPS_Pay2New'
    case 'credit_card':
      return source === 'BBPS_Pay2New_Credit_Card' || source === 'BBPS_Rechargekit_Credit_Card'
    case 'pay2new':
      return source === 'BBPS_Pay2New' || source === 'BBPS_Pay2New_Credit_Card'
    case 'rechargekit':
      return source === 'BBPS_Rechargekit_Credit_Card'
    default:
      return true
  }
}

function parseLedgerMeta(description: string) {
  const text = description || ''
  const chargeMatch = text.match(/\+\s*₹?([\d,.]+)\s*(?:GST|charge)/i)
  const totalChargeWithGst = chargeMatch ? parseFloat(chargeMatch[1].replace(/,/g, '')) : 0
  const charge = totalChargeWithGst > 0 ? Math.round(totalChargeWithGst / (1 + GST_RATE) * 100) / 100 : 0
  const gst = totalChargeWithGst > 0 ? Math.round((totalChargeWithGst - charge) * 100) / 100 : 0
  const cardMatch = text.match(/Card:([*\dXx]+)/i)
  const mobMatch = text.match(/Mob:(\d{8,15})/i)
  const isRechargekit = /rechargekit|CC-2/i.test(text)
  const isPay2newCc = !isRechargekit && (/\bBBPS-2\s*CC\b/i.test(text) || /^CC\s*₹/i.test(text.trim()) || (/Card:/i.test(text) && /pay2new|BBPS-2|^CC\b/i.test(text)))
  const isPay2new = !isRechargekit && (isPay2newCc || /BBPS-2|pay2new/i.test(text) || /^CC\s*₹/i.test(text.trim()))
  return {
    totalChargeWithGst,
    charge,
    gst,
    card_number: cardMatch?.[1] || '-',
    mobile: mobMatch?.[1] || '-',
    isRechargekit,
    isPay2newCc,
    isPay2new,
  }
}

function resolvePay2newSource(description: string, serviceType?: string | null): ProviderCode {
  const meta = parseLedgerMeta(description)
  if (serviceType === 'rechargekit' || meta.isRechargekit) return 'BBPS_Rechargekit_Credit_Card'
  if (meta.isPay2newCc || /Card:/i.test(description || '')) return 'BBPS_Pay2New_Credit_Card'
  return 'BBPS_Pay2New'
}

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
    const rawProvider = (searchParams.get('provider') || '').toLowerCase().trim()
    const providerFilter: ProviderFilter =
      ['bbps', 'credit_card', 'pay2new', 'rechargekit'].includes(rawProvider)
        ? (rawProvider as ProviderFilter)
        : ''
    const rawLimit = parseInt(searchParams.get('limit') || '25', 10)
    const format = searchParams.get('format') || 'json'
    const isExport = ['csv', 'excel', 'pdf'].includes(format)
    const limit = isExport ? Math.min(10000, Math.max(1, rawLimit || 10000)) : [10, 25, 100].includes(rawLimit) ? rawLimit : 25
    const offset = parseInt(searchParams.get('offset') || '0')

    // Admin targeted filters
    let adminUserIds: string[] | null = null
    let adminPartnerId: string | null = null
    if (user.role === 'admin' || user.role === 'finance_executive') {
      const filterUserId = searchParams.get('user_id')?.trim()
      const filterDistributorId = searchParams.get('distributor_id')?.trim()
      const filterMdId = searchParams.get('md_id')?.trim()
      const filterPartnerId = searchParams.get('partner_id')?.trim()

      if (filterPartnerId) {
        adminPartnerId = filterPartnerId
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

    function getUserScope(): string[] | null {
      if (user.role === 'partner') return partnerScope?.length ? partnerScope : []
      if (user.role === 'retailer') return user.partner_id ? [user.partner_id] : []
      if (user.role === 'distributor' || user.role === 'master_distributor') return (effectiveDownline && effectiveDownline.length > 0) ? effectiveDownline : []
      if (adminUserIds) return adminUserIds
      return null
    }
    const scope = getUserScope()
    if (Array.isArray(scope) && scope.length === 0) {
      return NextResponse.json({ success: true, data: [], summary: emptyStats(), pagination: emptyPagination(limit, offset) })
    }

    // Partner API ledger: own partner, specific partner filter, or admin "All Users"
    const loadPartnerLedger =
      user.role === 'partner' ||
      ((user.role === 'admin' || user.role === 'finance_executive') && (!!adminPartnerId || !adminUserIds))
    const bpPartnerId = user.role === 'partner' ? user.partner_id : adminPartnerId

    let allRows: any[] = []

    const fetchAll = async (baseFactory: () => any, mapRow: (tx: any) => any) => {
      const size = 1000
      for (let from = 0; from < 100000; from += size) {
        const q = baseFactory().range(from, from + size - 1)
        const { data, error } = await q
        if (error) { console.error('[Bill Payment] fetch error:', error); break }
        if (!data || data.length === 0) break
        allRows = allRows.concat(data.map(mapRow))
        if (data.length < size) break
      }
    }

    // 1. bbps_transactions (BBPS-1) — excludes rechargekit entries (handled via wallet_ledger)
    await fetchAll(() => {
      let q = supabase.from('bbps_transactions').select('*').order('created_at', { ascending: false })
        .not('biller_id', 'like', 'RKCC_%')
      if (scope) q = q.in('retailer_id', scope)
      if (dateFrom) q = q.gte('created_at', dateFrom)
      if (dateTo) q = q.lte('created_at', dateTo)
      if (search) q = q.or(`transaction_id.ilike.%${sanitize(search)}%,agent_transaction_id.ilike.%${sanitize(search)}%`)
      return q
    }, (tx: any) => {
      const charge = Number(tx.retailer_charge) || Number(tx.commission_amount) || 0
      const gst = 0
      const source: ProviderCode = 'BBPS_1'
      return {
        date: tx.created_at,
        transaction_id: tx.transaction_id || tx.agent_transaction_id || tx.id,
        operator: source,
        biller_name: tx.biller_name || '-',
        customer_name: tx.consumer_name || '-',
        mobile: '-',
        card_number: '-',
        customer_number: tx.consumer_number || '-',
        bill_amount: Number(tx.bill_amount) || 0,
        charge,
        gst,
        total_debit: (Number(tx.amount_paid) || Number(tx.bill_amount) || 0) + charge,
        reference_number: tx.transaction_id || tx.agent_transaction_id || '-',
        status: tx.status || 'pending',
        user_id: tx.retailer_id || '-',
        user_name: null as string | null,
        user_type: 'retailer' as const,
        retailer_id: tx.retailer_id,
        retailer_name: null as string | null,
        source,
      }
    })

    // 2. wallet_ledger — Pay2New + Rechargekit (retailer network)
    await fetchAll(() => {
      let q = supabase.from('wallet_ledger')
        .select('*')
        .in('service_type', ['pay2new', 'rechargekit'])
        .in('transaction_type', ['PAY2NEW_DEBIT', 'RECHARGEKIT_CC_DEBIT'])
        .order('created_at', { ascending: false })
      if (scope) q = q.in('retailer_id', scope)
      if (dateFrom) q = q.gte('created_at', dateFrom)
      if (dateTo) q = q.lte('created_at', dateTo)
      if (search) q = q.ilike('reference_id', `%${sanitize(search)}%`)
      return q
    }, (tx: any) => {
      const debitAmt = Number(tx.debit) || 0
      const description = tx.description || tx.remarks || ''
      const meta = parseLedgerMeta(description)
      const source = tx.service_type === 'rechargekit'
        ? 'BBPS_Rechargekit_Credit_Card' as ProviderCode
        : resolvePay2newSource(description, tx.service_type)
      const billAmount = debitAmt - meta.totalChargeWithGst
      return {
        date: tx.created_at,
        transaction_id: tx.reference_id || tx.id,
        operator: source,
        biller_name: '-',
        customer_name: '-',
        mobile: meta.mobile,
        card_number: meta.card_number,
        customer_number: meta.card_number !== '-' ? meta.card_number : meta.mobile,
        bill_amount: billAmount > 0 ? billAmount : debitAmt,
        charge: meta.charge,
        gst: meta.gst,
        total_debit: debitAmt,
        reference_number: tx.reference_id || '-',
        status: tx.status || 'completed',
        user_id: tx.retailer_id || '-',
        user_name: null as string | null,
        user_type: 'retailer' as const,
        retailer_id: tx.retailer_id,
        retailer_name: null as string | null,
        source,
        _ref_id: tx.reference_id || '',
        _refund_table: 'wallet_ledger' as const,
      }
    })

    // Cross-reference wallet_ledger refunds
    const ledgerRows = allRows.filter((r: any) => r._refund_table === 'wallet_ledger')
    if (ledgerRows.length > 0) {
      const refIds = ledgerRows.map((r: any) => r._ref_id).filter(Boolean)
      if (refIds.length > 0) {
        const refundSet = new Set<string>()
        const batchSize = 300
        for (let i = 0; i < refIds.length; i += batchSize) {
          const batch = refIds.slice(i, i + batchSize).map((id: string) => `REFUND_${id}`)
          const { data: refunds } = await supabase
            .from('wallet_ledger')
            .select('reference_id')
            .in('reference_id', batch)
            .in('transaction_type', ['PAY2NEW_REFUND', 'RECHARGEKIT_CC_REFUND'])
          for (const r of refunds || []) {
            refundSet.add(r.reference_id.replace(/^REFUND_/, ''))
          }
        }
        for (const row of allRows) {
          if ((row as any)._refund_table === 'wallet_ledger' && (row as any)._ref_id && refundSet.has((row as any)._ref_id)) {
            row.status = 'failed'
          }
        }
      }
    }

    // Enrich Rechargekit / Pay2New rows from bbps_transactions when available (RKCC_ records)
    const ledgerRefIds = allRows
      .filter((r: any) => r.source === 'BBPS_Rechargekit_Credit_Card' || r.source === 'BBPS_Pay2New_Credit_Card')
      .map((r: any) => r.transaction_id)
      .filter(Boolean)
    if (ledgerRefIds.length > 0) {
      const txMap = new Map<string, any>()
      const batchSize = 200
      for (let i = 0; i < ledgerRefIds.length; i += batchSize) {
        const batch = ledgerRefIds.slice(i, i + batchSize)
        const { data: txs } = await supabase
          .from('bbps_transactions')
          .select('agent_transaction_id, consumer_name, consumer_number, additional_info, biller_name')
          .in('agent_transaction_id', batch)
        for (const t of txs || []) {
          if (t.agent_transaction_id) txMap.set(t.agent_transaction_id, t)
        }
      }
      for (const row of allRows) {
        const t = txMap.get(row.transaction_id)
        if (!t) continue
        if (t.consumer_name) row.customer_name = t.consumer_name
        if (t.biller_name) row.biller_name = t.biller_name
        const info = t.additional_info || {}
        if (info.mobile && (row.mobile === '-' || !row.mobile)) row.mobile = String(info.mobile)
        if (t.consumer_number && (row.card_number === '-' || !row.card_number)) {
          row.card_number = t.consumer_number
          row.customer_number = t.consumer_number
        }
      }
    }

    // 3. Partner API bill payments (JMP Nextgen, Paymatrix, etc.)
    if (loadPartnerLedger) {
      await fetchAll(() => {
        let q = supabase.from('partner_wallet_ledger')
          .select('*')
          .eq('transaction_type', 'DEBIT')
          .or('service_type.in.(pay2new,rechargekit,bbps),description.ilike.BBPS-2%,description.ilike.CC-2%,description.ilike.CC %')
          .order('created_at', { ascending: false })
        if (bpPartnerId) q = q.eq('partner_id', bpPartnerId)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo) q = q.lte('created_at', dateTo)
        if (search) q = q.ilike('reference_id', `%${sanitize(search)}%`)
        return q
      }, (tx: any) => {
        const debitAmt = Number(tx.debit) || Number(tx.amount) || 0
        const description = tx.description || ''
        const meta = parseLedgerMeta(description)
        let source: ProviderCode
        if (tx.service_type === 'rechargekit' || meta.isRechargekit) {
          source = 'BBPS_Rechargekit_Credit_Card'
        } else if (tx.service_type === 'pay2new' || meta.isPay2new) {
          source = meta.isPay2newCc || /Card:/i.test(description)
            ? 'BBPS_Pay2New_Credit_Card'
            : 'BBPS_Pay2New'
        } else {
          source = 'BBPS_1'
        }
        // Skip non-bill partner debits that somehow match (e.g. plain payouts with service_type null already excluded)
        const billAmount = debitAmt - meta.totalChargeWithGst
        return {
          date: tx.created_at,
          transaction_id: tx.reference_id || tx.id,
          operator: source,
          biller_name: '-',
          customer_name: '-',
          mobile: meta.mobile,
          card_number: meta.card_number,
          customer_number: meta.card_number !== '-' ? meta.card_number : meta.mobile,
          bill_amount: billAmount > 0 ? billAmount : debitAmt,
          charge: meta.charge,
          gst: meta.gst,
          total_debit: debitAmt,
          reference_number: tx.reference_id || '-',
          status: tx.status || 'completed',
          user_id: tx.partner_id || '-',
          user_name: null as string | null,
          user_type: 'partner' as const,
          retailer_id: null,
          retailer_name: null as string | null,
          source,
          _ref_id: tx.reference_id || '',
          _refund_table: 'partner_wallet_ledger' as const,
          _partner_id: tx.partner_id,
        }
      })

      // Partner refunds → failed
      const partnerRows = allRows.filter((r: any) => r._refund_table === 'partner_wallet_ledger')
      const pRefIds = partnerRows.map((r: any) => r._ref_id).filter(Boolean)
      if (pRefIds.length > 0) {
        const refundSet = new Set<string>()
        const batchSize = 300
        for (let i = 0; i < pRefIds.length; i += batchSize) {
          const batch = pRefIds.slice(i, i + batchSize).map((id: string) => `REFUND_${id}`)
          let rq = supabase
            .from('partner_wallet_ledger')
            .select('reference_id')
            .eq('transaction_type', 'REFUND')
            .in('reference_id', batch)
          if (bpPartnerId) rq = rq.eq('partner_id', bpPartnerId)
          const { data: refunds } = await rq
          for (const r of refunds || []) {
            refundSet.add(r.reference_id.replace(/^REFUND_/, ''))
          }
        }
        for (const row of allRows) {
          if ((row as any)._refund_table === 'partner_wallet_ledger' && (row as any)._ref_id && refundSet.has((row as any)._ref_id)) {
            row.status = 'failed'
          }
        }
      }
    }

    // Provider filter (before status-card breakdown)
    if (providerFilter) {
      allRows = allRows.filter((r: any) => matchesProviderFilter(r.source as ProviderCode, providerFilter))
    }

    // Clean up internal fields
    for (const row of allRows) {
      delete (row as any)._ref_id
      delete (row as any)._service_type
      delete (row as any)._refund_table
      delete (row as any)._partner_id
    }

    const bucketOf = (s: string): 'success' | 'failed' | 'pending' | null => {
      if (['success', 'completed'].includes(s)) return 'success'
      if (s === 'failed') return 'failed'
      if (['pending', 'initiated', 'processing'].includes(s)) return 'pending'
      return null
    }

    const blankBucket = () => ({ count: 0, bill_amount: 0, charges: 0, gst: 0, total_debit: 0 })
    const by_status = { success: blankBucket(), failed: blankBucket(), pending: blankBucket() }
    for (const r of allRows) {
      const b = bucketOf(r.status)
      if (!b) continue
      by_status[b].count += 1
      by_status[b].bill_amount += r.bill_amount
      by_status[b].charges += r.charge
      by_status[b].gst += r.gst
      by_status[b].total_debit += r.total_debit
    }

    if (status) {
      const target = status.toLowerCase()
      const targetBucket = target === 'success' ? 'success' : target === 'failed' ? 'failed' : target === 'pending' || target === 'initiated' || target === 'processing' ? 'pending' : null
      allRows = allRows.filter((r: any) => {
        if (targetBucket) return bucketOf(r.status) === targetBucket
        return r.status === target
      })
    }

    allRows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    // Enrich retailer names
    const retailerIds = Array.from(new Set(allRows.filter(r => r.user_type === 'retailer').map(r => r.user_id).filter(id => id && id !== '-')))
    if (retailerIds.length > 0) {
      const { data: retailers } = await supabase.from('retailers').select('partner_id, name').in('partner_id', retailerIds)
      const nameMap = new Map((retailers || []).map((r: any) => [r.partner_id, r.name]))
      allRows.forEach(r => {
        if (r.user_type === 'retailer' && r.user_id) {
          r.user_name = nameMap.get(r.user_id) || null
          r.retailer_name = r.user_name
        }
      })
    }

    // Enrich partner names (API partners)
    const partnerIds = Array.from(new Set(allRows.filter(r => r.user_type === 'partner').map(r => r.user_id).filter(id => id && id !== '-')))
    if (partnerIds.length > 0) {
      const { data: partnersById } = await supabase.from('partners').select('id, partner_id, name, business_name').in('id', partnerIds)
      const { data: partnersByPid } = await supabase.from('partners').select('id, partner_id, name, business_name').in('partner_id', partnerIds)
      const nameMap = new Map<string, string>()
      for (const p of partnersById || []) {
        const n = p.business_name || p.name
        if (n) nameMap.set(p.id, n)
      }
      for (const p of partnersByPid || []) {
        const n = p.business_name || p.name
        if (n && p.partner_id) nameMap.set(p.partner_id, n)
        if (n) nameMap.set(p.id, n)
      }
      allRows.forEach(r => {
        if (r.user_type === 'partner' && r.user_id) {
          r.user_name = nameMap.get(r.user_id) || null
        }
      })
    }

    const summary = {
      total_transactions: allRows.length,
      total_bill_amount: allRows.reduce((s, r) => s + r.bill_amount, 0),
      total_charges: allRows.reduce((s, r) => s + r.charge, 0),
      total_gst: allRows.reduce((s, r) => s + r.gst, 0),
      total_debit: allRows.reduce((s, r) => s + r.total_debit, 0),
      success_count: by_status.success.count,
      failed_count: by_status.failed.count,
      pending_count: by_status.pending.count,
      by_status,
    }

    const billColumns: ReportColumn[] = [
      { header: 'Date', key: 'date', type: 'date' },
      { header: 'Transaction ID', key: 'transaction_id' },
      { header: 'Provider', key: 'operator' },
      { header: 'User ID', key: 'user_id' },
      { header: 'User Name', key: 'user_name' },
      { header: 'Customer Name', key: 'customer_name' },
      { header: 'Mobile', key: 'mobile' },
      { header: 'Card Number', key: 'card_number' },
      { header: 'Customer Number', key: 'customer_number' },
      { header: 'Bill Amount (₹)', key: 'bill_amount', type: 'currency' },
      { header: 'Charge (₹)', key: 'charge', type: 'currency' },
      { header: 'GST (₹)', key: 'gst', type: 'currency' },
      { header: 'Total Debit (₹)', key: 'total_debit', type: 'currency' },
      { header: 'Reference Number', key: 'reference_number' },
      { header: 'Status', key: 'status' },
    ]
    const reportFilename = `bill_payment_report_${Date.now()}`
    const reportMeta = {
      title: 'Bill Payment Transaction Report',
      dateRange: { from: dateFrom, to: dateTo },
      summaryCards: [
        { label: 'Total Transactions', value: String(summary.total_transactions) },
        { label: 'Total Bill Amount', value: `₹${summary.total_bill_amount.toFixed(2)}` },
        { label: 'Total Charges', value: `₹${summary.total_charges.toFixed(2)}` },
        { label: 'Success / Failed / Pending', value: `${summary.success_count} / ${summary.failed_count} / ${summary.pending_count}` },
      ],
    }

    if (format === 'csv') {
      return generateCSVResponse(allRows, billColumns, reportFilename, reportMeta)
    }
    if (format === 'excel') {
      return generateExcelResponse(allRows, billColumns, reportFilename, 'Bill Payment Transactions')
    }
    if (format === 'pdf') {
      return await generatePDFResponse(allRows, billColumns, reportFilename, reportMeta, { accentColor: '#059669' })
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
      }
    })
  } catch (error: any) {
    console.error('[Bill Payment Report] Error:', error)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}

function emptyStats() {
  const blankBucket = () => ({ count: 0, bill_amount: 0, charges: 0, gst: 0, total_debit: 0 })
  return {
    total_transactions: 0, total_bill_amount: 0, total_charges: 0, total_gst: 0, total_debit: 0,
    success_count: 0, failed_count: 0, pending_count: 0,
    by_status: { success: blankBucket(), failed: blankBucket(), pending: blankBucket() },
  }
}

function emptyPagination(limit: number, offset: number) {
  return { total: 0, limit, offset, page: 1, totalPages: 0 }
}
