import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sanitize(value: string): string {
  return value.replace(/[,()\\*%]/g, '').trim()
}

function escapeXml(str: string) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
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

/**
 * DT/MD downline sub-filter. Narrows the downline to a selected retailer (DT/MD)
 * or all retailers under a selected distributor (MD). Returns null for non DT/MD roles.
 */
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
    const rawLimit = parseInt(searchParams.get('limit') || '25', 10)
    const format = searchParams.get('format') || 'json'
    const isExport = ['csv', 'excel'].includes(format)
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

    // Resolve retailer_id scope (null = admin/finance full access)
    let scopeIds: string[] | null = null
    if (user.role === 'partner') {
      if (!partnerScope?.length) return NextResponse.json({ success: true, data: [], summary: emptyStats(), pagination: emptyPagination(limit, offset) })
      scopeIds = partnerScope
    } else if (user.role === 'retailer') {
      scopeIds = user.partner_id ? [user.partner_id] : []
      if (!scopeIds.length) return NextResponse.json({ success: true, data: [], summary: emptyStats(), pagination: emptyPagination(limit, offset) })
    } else if (user.role === 'distributor' || user.role === 'master_distributor') {
      if (effectiveDownline && effectiveDownline.length > 0) scopeIds = effectiveDownline
      else return NextResponse.json({ success: true, data: [], summary: emptyStats(), pagination: emptyPagination(limit, offset) })
    } else if (adminUserIds) {
      scopeIds = adminUserIds
    }

    // Partner POS transactions are keyed by partner_id; linked merchants by retailer_id
    const posPartnerId = user.role === 'partner' ? user.partner_id : adminPartnerId
    const applyFilters = (q: any) => {
      if (posPartnerId) {
        const orParts = [`partner_id.eq.${posPartnerId}`]
        if (scopeIds?.length) orParts.push(`retailer_id.in.(${scopeIds.join(',')})`)
        q = q.or(orParts.join(','))
      } else if (scopeIds) {
        q = q.in('retailer_id', scopeIds)
      }
      if (dateFrom) q = q.gte('transaction_time', dateFrom)
      if (dateTo) q = q.lte('transaction_time', dateTo)
      if (status) q = q.eq('display_status', status.toUpperCase())
      if (search) q = q.ilike('txn_id', `%${sanitize(search)}%`)
      return q
    }

    // Fetch the entire filtered set (chunked) so totals/export cover all rows, not just the page
    const allTx: any[] = []
    const pageSize = 1000
    for (let from = 0; from < 100000; from += pageSize) {
      const q = applyFilters(
        supabase.from('razorpay_pos_transactions').select('*').order('transaction_time', { ascending: false })
      ).range(from, from + pageSize - 1)
      const { data: chunk, error: chunkErr } = await q
      if (chunkErr) {
        console.error('[POS Report] Query error:', chunkErr)
        return NextResponse.json({ error: 'Failed to fetch POS transactions' }, { status: 500 })
      }
      if (!chunk || chunk.length === 0) break
      allTx.push(...chunk)
      if (chunk.length < pageSize) break
    }

    const allRows = allTx.map((tx: any) => {
      const isPartnerTx = !!posPartnerId && tx.partner_id === posPartnerId
      const mdrRate = isPartnerTx ? (tx.partner_mdr_rate ?? tx.mdr_rate ?? 0) : (tx.mdr_rate || 0)
      const mdrAmount = isPartnerTx ? (tx.partner_mdr_amount ?? tx.mdr_amount ?? 0) : (tx.mdr_amount || 0)
      return {
        date: tx.transaction_time || tx.created_at,
        transaction_id: tx.txn_id || tx.id,
        tid: tx.tid || '-',
        merchant_name: tx.merchant_name || '-',
        card_type: tx.card_type || '-',
        amount: tx.amount || 0,
        mdr_rate: mdrRate,
        mdr_amount: mdrAmount,
        settlement_amount: (tx.amount || 0) - mdrAmount,
        status: tx.display_status || tx.status || 'PENDING',
        retailer_id: tx.retailer_id,
        retailer_name: null as string | null,
        distributor_id: tx.distributor_id,
        master_distributor_id: tx.master_distributor_id,
      }
    })

    // Enrich retailer names
    const retailerIds = Array.from(new Set(allRows.map(r => r.retailer_id).filter(Boolean)))
    if (retailerIds.length > 0) {
      const { data: retailers } = await supabase.from('retailers').select('partner_id, name').in('partner_id', retailerIds)
      const nameMap = new Map((retailers || []).map((r: any) => [r.partner_id, r.name]))
      allRows.forEach(r => { if (r.retailer_id) r.retailer_name = nameMap.get(r.retailer_id) || null })
    }

    // Summary computed over the FULL filtered set
    const summary = {
      total_transactions: allRows.length,
      total_amount: allRows.reduce((s, r) => s + r.amount, 0),
      total_mdr: allRows.reduce((s, r) => s + r.mdr_amount, 0),
      total_settlement: allRows.reduce((s, r) => s + r.settlement_amount, 0),
      success_count: allRows.filter(r => ['SUCCESS', 'CAPTURED', 'success', 'captured'].includes(r.status)).length,
      failed_count: allRows.filter(r => ['FAILED', 'failed'].includes(r.status)).length,
      pending_count: allRows.filter(r => ['PENDING', 'pending'].includes(r.status)).length,
    }

    if (format === 'excel') {
      return generateExcel(allRows, dateFrom, dateTo)
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
    console.error('[POS Report] Error:', error)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}

function emptyStats() {
  return { total_transactions: 0, total_amount: 0, total_mdr: 0, total_settlement: 0, success_count: 0, failed_count: 0, pending_count: 0 }
}

function emptyPagination(limit: number, offset: number) {
  return { total: 0, limit, offset, page: 1, totalPages: 0 }
}

function generateExcel(rows: any[], dateFrom: string | null, dateTo: string | null) {
  const headers = [
    'Date & Time', 'Transaction ID', 'Terminal ID (TID)', 'Merchant Name',
    'Card Type', 'Transaction Amount (₹)', 'MDR Rate (%)', 'MDR Amount (₹)',
    'Settlement Amount (₹)', 'Status',
  ]

  const headerRow = `<Row>${headers.map(h => `<Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`).join('')}</Row>`

  const xmlRows = rows.map(r => {
    const strCell = (v: string) => `<Cell><Data ss:Type="String">${escapeXml(v || '-')}</Data></Cell>`
    const numCell = (v: number) => `<Cell><Data ss:Type="Number">${v}</Data></Cell>`
    return `<Row>
      ${strCell(new Date(r.date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))}
      ${strCell(r.transaction_id)}
      ${strCell(r.tid)}
      ${strCell(r.merchant_name)}
      ${strCell(r.card_type)}
      ${numCell(r.amount)}
      ${numCell(Math.round(r.mdr_rate * 100000) / 1000)}
      ${numCell(r.mdr_amount)}
      ${numCell(r.settlement_amount)}
      ${strCell(r.status)}
    </Row>`
  }).join('\n')

  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="POS Transactions">
    <Table>
      ${headerRow}
      ${xmlRows}
    </Table>
  </Worksheet>
</Workbook>`

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/vnd.ms-excel',
      'Content-Disposition': `attachment; filename="pos_transaction_report_${Date.now()}.xls"`,
    },
  })
}
