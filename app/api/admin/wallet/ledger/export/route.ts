import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { getPlatformRevenueWalletConfig } from '@/lib/wallet/platform-revenue-wallet'
import { htmlToPdf } from '@/lib/pdf/html-to-pdf'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/wallet/ledger/export
 * Export wallet ledger as CSV or Excel (admin only).
 * Query params:
 * - format: csv | excel (default: csv)
 * - user_id: filter by retailer_id
 * - wallet_type: primary | aeps | all
 * - scope: all | platform
 * - service_type: filter by service type
 * - transaction_type: filter by transaction type
 * - date_from, date_to: date range
 * - q: search description
 * - limit: optional cap on total rows; omit to export the COMPLETE filtered set.
 *   CSV is streamed page-by-page (any size); Excel/PDF are buffered but uncapped.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const sp = request.nextUrl.searchParams
    const format = sp.get('format') || 'csv'
    // No practical cap: export the full filtered result set. `limit` is optional; if
    // omitted we fetch everything matching the filters via pagination.
    const rawLimit = parseInt(sp.get('limit') || '0', 10)
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : Infinity
    const userId = sp.get('user_id')?.trim() || ''
    const userRole = sp.get('user_role')?.trim() || ''
    const walletType = sp.get('wallet_type') || 'primary'
    const scope = sp.get('scope') || 'all'
    const serviceType = sp.get('service_type')?.trim() || ''
    const transactionType = sp.get('transaction_type')?.trim() || ''
    const status = sp.get('status')?.trim() || ''
    const dateFrom = sp.get('date_from')?.trim() || ''
    const dateTo = sp.get('date_to')?.trim() || ''
    const q = sp.get('q')?.trim() || ''

    const supabase = getSupabaseAdmin()

    // Partner ledger lives in partner_wallet_ledger (keyed by partner_id)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
    let isPartnerScope = userRole === 'partner'
    if (!isPartnerScope && scope === 'all' && userId && isUuid) {
      const { data: partnerRow } = await supabase.from('partners').select('id').eq('id', userId).maybeSingle()
      if (partnerRow) isPartnerScope = true
    }

    const isPartner = isPartnerScope && scope === 'all'

    if (scope === 'platform' && !getPlatformRevenueWalletConfig()) {
      return NextResponse.json({ error: 'Platform revenue wallet not configured' }, { status: 400 })
    }

    // Single query factory reused by both the streaming (CSV) and buffered (Excel/PDF)
    // paths. Must return a fresh, ordered builder each call so pagination is deterministic.
    const buildQuery = () => {
      if (isPartner) {
        let pq = supabase.from('partner_wallet_ledger').select('*')
        if (userId) pq = pq.eq('partner_id', userId)
        if (serviceType && serviceType !== 'all') pq = pq.eq('service_type', serviceType)
        if (transactionType && transactionType !== 'all') pq = pq.eq('transaction_type', transactionType)
        if (status && status !== 'all') pq = pq.eq('status', status)
        if (dateFrom) pq = pq.gte('created_at', `${dateFrom}T00:00:00`)
        if (dateTo) pq = pq.lte('created_at', `${dateTo}T23:59:59`)
        if (q) pq = pq.ilike('description', `%${q.replace(/%/g, '\\%')}%`)
        return pq.order('created_at', { ascending: false })
      }
      let query = supabase
        .from('wallet_ledger')
        .select('id, retailer_id, user_role, wallet_type, fund_category, service_type, transaction_type, credit, debit, opening_balance, closing_balance, balance_after, description, reference_id, status, created_at')
      if (scope === 'platform') {
        const cfg = getPlatformRevenueWalletConfig()
        if (cfg) query = query.eq('retailer_id', cfg.revenueUserId)
      } else if (userId) {
        query = query.eq('retailer_id', userId)
      }
      if (userRole && userRole !== 'all') query = query.eq('user_role', userRole)
      if (walletType && walletType !== 'all') query = query.eq('wallet_type', walletType)
      if (serviceType && serviceType !== 'all') query = query.eq('service_type', serviceType)
      if (transactionType && transactionType !== 'all') query = query.eq('transaction_type', transactionType)
      if (status && status !== 'all') query = query.eq('status', status)
      if (dateFrom) query = query.gte('created_at', `${dateFrom}T00:00:00`)
      if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59`)
      if (q) query = query.ilike('description', `%${q.replace(/%/g, '\\%')}%`)
      return query.order('created_at', { ascending: false })
    }

    const mapRow = isPartner
      ? (r: any) => ({ ...r, retailer_id: r.partner_id, user_role: 'partner', wallet_type: 'partner_api' })
      : (r: any) => r

    const filePrefix = scope === 'platform' ? 'revenue-wallet-statement' : 'wallet-ledger'
    const fileDate = new Date().toISOString().split('T')[0]

    // CSV: stream the complete filtered result set page-by-page with (near-)constant
    // memory, so exports of any size (1K … millions of rows) succeed without buffering.
    if (format !== 'excel' && format !== 'pdf') {
      const encoder = new TextEncoder()
      const csvHeader =
        'Date & Time,User ID,User Name,Role,Wallet,Transaction Type,Service,Credit (₹),Debit (₹),Opening Balance (₹),Closing Balance (₹),Status,Reference ID,Description\n'

      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode('\uFEFF' + csvHeader))
          const PAGE_SIZE = 1000
          let from = 0
          let fetched = 0
          try {
            while (fetched < limit) {
              const pageSize = Math.min(PAGE_SIZE, limit - fetched)
              const { data, error } = await buildQuery().range(from, from + pageSize - 1)
              if (error) throw new Error(error.message)
              const rows = (data || []).map(mapRow)
              if (rows.length === 0) break
              const nameMap = await resolveNames(supabase, rows.map((r: any) => r.retailer_id))
              const chunk = rows.map((e: any) => csvLine(e, nameMap)).join('\n') + '\n'
              controller.enqueue(encoder.encode(chunk))
              fetched += rows.length
              if (rows.length < pageSize) break
              from += rows.length
            }
            controller.close()
          } catch (err: any) {
            console.error('[admin/wallet/ledger/export] stream', err)
            controller.error(err)
          }
        },
      })

      return new NextResponse(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filePrefix}-${fileDate}.csv"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    // Excel / PDF: need the whole document assembled in memory, but still fetch the
    // complete filtered set via pagination (no 1000-row cap).
    const { data: allRows, error: fetchErr } = await fetchAllRows(buildQuery, limit)
    if (fetchErr) {
      console.error('[admin/wallet/ledger/export]', fetchErr)
      return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    }
    const entries = allRows.map(mapRow)
    const nameMap = await resolveNames(supabase, entries.map((e: any) => e.retailer_id))

    if (format === 'pdf') {
      const pdfHeaders = ['Date & Time', 'User ID', 'User Name', 'Role', 'Wallet', 'Txn Type', 'Service', 'Credit', 'Debit', 'Opening', 'Closing', 'Status', 'Ref ID']
      const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Wallet Ledger</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; padding: 30px; color: #333; font-size: 11px; }
  .header { text-align: center; margin-bottom: 20px; border-bottom: 3px solid #4F46E5; padding-bottom: 12px; }
  .header h1 { font-size: 20px; color: #4F46E5; }
  .header p { font-size: 11px; color: #666; }
  table { width: 100%; border-collapse: collapse; font-size: 9px; }
  th { background: #4F46E5; color: #fff; padding: 6px 4px; text-align: left; font-weight: 600; }
  td { padding: 4px; border-bottom: 1px solid #E5E7EB; }
  tr:nth-child(even) { background: #F9FAFB; }
  .cr { color: #16A34A; font-weight: 600; }
  .dr { color: #DC2626; font-weight: 600; }
  .footer { margin-top: 15px; text-align: center; font-size: 10px; color: #888; border-top: 1px solid #E5E7EB; padding-top: 8px; }
  @media print { body { padding: 10px; } @page { size: landscape; margin: 8mm; } }
</style></head><body>
  <div class="header">
    <h1>${scope === 'platform' ? 'Revenue Wallet Statement' : 'Wallet Ledger Report'}</h1>
    <p>Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} | Records: ${entries.length}</p>
  </div>
  <table><thead><tr>${pdfHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead>
  <tbody>${entries.map((e: any) => {
        const cr = Number(e.credit) || 0
        const dr = Number(e.debit) || 0
        const op = Number(e.opening_balance) || 0
        const cl = Number(e.closing_balance ?? e.balance_after ?? 0)
        return `<tr>
          <td>${formatDate(e.created_at)}</td>
          <td>${e.retailer_id || ''}</td>
          <td>${nameMap[e.retailer_id] || ''}</td>
          <td>${e.user_role || ''}</td>
          <td>${e.wallet_type || ''}</td>
          <td>${e.transaction_type || ''}</td>
          <td>${e.service_type || ''}</td>
          <td class="cr">${cr ? '\u20B9' + cr.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : ''}</td>
          <td class="dr">${dr ? '\u20B9' + dr.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : ''}</td>
          <td>\u20B9${op.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
          <td>\u20B9${cl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
          <td>${e.status || ''}</td>
          <td>${e.reference_id || ''}</td>
        </tr>`
      }).join('')}</tbody></table>
  <div class="footer">Same Day Solution &mdash; System Generated Report &copy; ${new Date().getFullYear()}</div>
</body></html>`

      const pdf = await htmlToPdf(html, { landscape: true })
      if (pdf) {
        return new NextResponse(new Uint8Array(pdf), {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filePrefix}-${fileDate}.pdf"`,
          },
        })
      }
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filePrefix}-${fileDate}.html"`,
        },
      })
    }

    if (format === 'excel') {
      // Generate Excel using simple XML spreadsheet format
      const xmlRows = entries.map((e: any) => {
        const credit = Number(e.credit) || 0
        const debit = Number(e.debit) || 0
        const opening = Number(e.opening_balance) || 0
        const balance = Number(e.closing_balance ?? e.balance_after ?? 0)
        return `<Row>
          <Cell><Data ss:Type="String">${escapeXml(formatDate(e.created_at))}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(e.retailer_id || '')}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(nameMap[e.retailer_id] || '')}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(e.user_role || '')}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(e.wallet_type || '')}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(e.transaction_type || '')}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(e.service_type || '')}</Data></Cell>
          <Cell><Data ss:Type="Number">${credit}</Data></Cell>
          <Cell><Data ss:Type="Number">${debit}</Data></Cell>
          <Cell><Data ss:Type="Number">${opening}</Data></Cell>
          <Cell><Data ss:Type="Number">${balance}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(e.status || '')}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(e.reference_id || '')}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(e.description || '')}</Data></Cell>
        </Row>`
      }).join('\n')

      const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="Wallet Ledger">
    <Table>
      <Row>
        <Cell><Data ss:Type="String">Date &amp; Time</Data></Cell>
        <Cell><Data ss:Type="String">User ID</Data></Cell>
        <Cell><Data ss:Type="String">User Name</Data></Cell>
        <Cell><Data ss:Type="String">Role</Data></Cell>
        <Cell><Data ss:Type="String">Wallet</Data></Cell>
        <Cell><Data ss:Type="String">Transaction Type</Data></Cell>
        <Cell><Data ss:Type="String">Service</Data></Cell>
        <Cell><Data ss:Type="String">Credit (₹)</Data></Cell>
        <Cell><Data ss:Type="String">Debit (₹)</Data></Cell>
        <Cell><Data ss:Type="String">Opening Balance (₹)</Data></Cell>
        <Cell><Data ss:Type="String">Closing Balance (₹)</Data></Cell>
        <Cell><Data ss:Type="String">Status</Data></Cell>
        <Cell><Data ss:Type="String">Reference ID</Data></Cell>
        <Cell><Data ss:Type="String">Description</Data></Cell>
      </Row>
      ${xmlRows}
    </Table>
  </Worksheet>
</Workbook>`

      return new NextResponse(xml, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.ms-excel',
          'Content-Disposition': `attachment; filename="${filePrefix}-${fileDate}.xls"`,
        },
      })
    }

    return NextResponse.json({ error: 'Unsupported format' }, { status: 400 })
  } catch (e: any) {
    console.error('[admin/wallet/ledger/export]', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}

/**
 * Fetches ALL rows matching a query, working around PostgREST's per-request row cap
 * (db-max-rows, default 1000) by paginating with .range(). `buildQuery` must return a
 * fresh, ordered query builder on every call so each page is deterministic.
 * `maxRows` optionally caps the total (Infinity = fetch everything).
 */
async function fetchAllRows(
  buildQuery: () => any,
  maxRows: number = Infinity
): Promise<{ data: any[]; error: any }> {
  const PAGE_SIZE = 1000
  const all: any[] = []
  let from = 0

  while (all.length < maxRows) {
    const remaining = maxRows - all.length
    const pageSize = Math.min(PAGE_SIZE, remaining)
    const to = from + pageSize - 1

    const { data, error } = await buildQuery().range(from, to)
    if (error) return { data: all, error }

    const rows = data || []
    all.push(...rows)

    // Last page reached when fewer rows than requested came back.
    if (rows.length < pageSize) break
    from += rows.length
  }

  return { data: all, error: null }
}

/** Resolve wallet-owner display names (RT/DT/MD/partner) for a batch of ids. */
async function resolveNames(supabase: any, ids: string[]): Promise<Record<string, string>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  const nameMap: Record<string, string> = {}
  if (uniqueIds.length === 0) return nameMap

  const [retRes, distRes, mdRes, partRes] = await Promise.all([
    supabase.from('retailers').select('partner_id, name, business_name').in('partner_id', uniqueIds),
    supabase.from('distributors').select('partner_id, name, business_name').in('partner_id', uniqueIds),
    supabase.from('master_distributors').select('partner_id, name, business_name').in('partner_id', uniqueIds),
    supabase.from('partners').select('id, name, business_name').in('id', uniqueIds),
  ])
  for (const r of retRes.data || []) nameMap[r.partner_id] = r.name || r.business_name || ''
  for (const d of distRes.data || []) nameMap[d.partner_id] = d.name || d.business_name || ''
  for (const m of mdRes.data || []) nameMap[m.partner_id] = m.name || m.business_name || ''
  for (const p of partRes.data || []) nameMap[p.id] = p.name || p.business_name || ''
  return nameMap
}

/** Build one CSV row for a ledger entry. */
function csvLine(e: any, nameMap: Record<string, string>): string {
  const credit = Number(e.credit) || 0
  const debit = Number(e.debit) || 0
  const opening = Number(e.opening_balance) || 0
  const balance = Number(e.closing_balance ?? e.balance_after ?? 0)
  return [
    `"${formatDate(e.created_at)}"`,
    `"${escapeCsv(e.retailer_id || '')}"`,
    `"${escapeCsv(nameMap[e.retailer_id] || '')}"`,
    `"${escapeCsv(e.user_role || '')}"`,
    `"${escapeCsv(e.wallet_type || '')}"`,
    `"${escapeCsv(e.transaction_type || '')}"`,
    `"${escapeCsv(e.service_type || '')}"`,
    credit.toFixed(2),
    debit.toFixed(2),
    opening.toFixed(2),
    balance.toFixed(2),
    `"${escapeCsv(e.status || '')}"`,
    `"${escapeCsv(e.reference_id || '')}"`,
    `"${escapeCsv(e.description || '')}"`,
  ].join(',')
}

function formatDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return isoString
  }
}

function escapeCsv(str: string): string {
  return str.replace(/"/g, '""')
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
