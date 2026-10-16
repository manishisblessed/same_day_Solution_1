import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { htmlToPdf } from '@/lib/pdf/html-to-pdf'
import JSZip from 'jszip'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const inr = (n: number) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function requireCA(request: NextRequest) {
  const { user } = await getCurrentUserWithFallback(request)
  if (!user) return { error: 'Session expired. Please login again.', status: 401 as const }
  if (user.role !== 'ca_executive' && user.role !== 'admin') {
    return { error: 'CA access required', status: 403 as const }
  }
  return { user }
}

/**
 * GET /api/ca/reimbursement
 *
 * Query params:
 *   brand_id, tid, date_from (YYYY-MM-DD), date_to, status (issued|void)
 *   page (1-based), limit (default 50, max 500)
 *   stats_only=1  → returns only aggregate stats + today stats (for dashboard)
 *   format=csv|excel  → export all rows
 */
export async function GET(request: NextRequest) {
  const auth = await requireCA(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const sp = request.nextUrl.searchParams
    const brandId = sp.get('brand_id')?.trim()
    const tid = sp.get('tid')?.trim()
    const dateFrom = sp.get('date_from')?.trim()
    const dateTo = sp.get('date_to')?.trim()
    const status = sp.get('status')?.trim()
    const statsOnly = sp.get('stats_only') === '1'
    const format = sp.get('format')?.trim()
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10))
    const limit = Math.min(500, Math.max(1, parseInt(sp.get('limit') || '50', 10)))

    const supabase = getSupabaseAdmin()

    // Dashboard stats mode
    if (statsOnly) {
      const today = new Date().toISOString().split('T')[0]

      const [todayRes, draftRes, configsRes] = await Promise.all([
        supabase
          .from('ca_reimbursement_invoices')
          .select('bank_mdr_amount, id', { count: 'exact' })
          .eq('transaction_date', today)
          .eq('status', 'issued'),
        supabase
          .from('ca_transaction_invoices')
          .select('id', { count: 'exact' })
          .eq('status', 'draft'),
        supabase
          .from('ca_bank_mdr_config')
          .select('id', { count: 'exact' })
          .eq('is_active', true),
      ])

      const todayRows = todayRes.data || []
      const todayBankMdr = todayRows.reduce((sum: number, r: any) => sum + Number(r.bank_mdr_amount || 0), 0)

      return NextResponse.json({
        today_count: todayRes.count ?? todayRows.length,
        today_bank_mdr: todayBankMdr,
        pending_invoices: draftRes.count ?? 0,
        total_configs: configsRes.count ?? 0,
      })
    }

    // Build base query
    const buildQuery = () => {
      let q = supabase
        .from('ca_reimbursement_invoices')
        .select(`
          *,
          brands:brand_id ( id, key, name, short_name ),
          partners:partner_id ( id, name ),
          ca_transaction_invoices:transaction_invoice_id ( id, invoice_number, status )
        `, { count: 'exact' })
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false })

      if (brandId) q = q.eq('brand_id', brandId)
      if (tid) q = q.eq('tid', tid)
      if (status) q = q.eq('status', status)
      if (dateFrom) q = q.gte('transaction_date', dateFrom)
      if (dateTo) q = q.lte('transaction_date', dateTo)
      return q
    }

    // Export formats
    if (format === 'csv' || format === 'excel' || format === 'pdf' || format === 'zip') {
      // Fetch all matching rows for export (paginated internally, max 10k)
      const PAGE_SIZE = 1000
      const allRows: any[] = []
      let from = 0
      while (allRows.length < 10000) {
        const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1)
        if (error) throw new Error(error.message)
        allRows.push(...(data || []))
        if ((data || []).length < PAGE_SIZE) break
        from += PAGE_SIZE
      }

      const fileDate = new Date().toISOString().split('T')[0]

      const buildCsv = () => {
        const header = 'Invoice No,Date,Brand,TID,Transaction Amount (₹),Payment Mode,Card Type,Card Brand,Bank MDR %,Bank MDR Amount (₹),GST Invoice,Status\n'
        const rows = allRows.map((r: any) =>
          [
            r.invoice_number,
            r.transaction_date,
            r.brands?.name || '',
            r.tid || '',
            Number(r.transaction_amount).toFixed(2),
            r.payment_mode || '',
            r.card_type || '',
            r.card_brand || '',
            Number(r.bank_mdr_percent).toFixed(4),
            Number(r.bank_mdr_amount).toFixed(2),
            r.ca_transaction_invoices?.invoice_number || '',
            r.status,
          ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')
        ).join('\n')
        return '\uFEFF' + header + rows
      }

      if (format === 'csv') {
        return new NextResponse(buildCsv(), {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="reimbursement-invoices-${fileDate}.csv"`,
          },
        })
      }

      // PDF + ZIP share the same report HTML
      if (format === 'pdf' || format === 'zip') {
        const totalAmount = allRows.reduce((s: number, r: any) => s + Number(r.transaction_amount || 0), 0)
        const totalMdr = allRows.reduce((s: number, r: any) => s + Number(r.bank_mdr_amount || 0), 0)
        const bodyRows = allRows.map((r: any) => `
          <tr>
            <td>${esc(r.invoice_number)}</td>
            <td>${esc(r.transaction_date)}</td>
            <td>${esc(r.brands?.short_name || r.brands?.name || '')}</td>
            <td>${esc(r.tid || '—')}</td>
            <td class="num">${inr(r.transaction_amount)}</td>
            <td>${esc(r.payment_mode || '')}</td>
            <td>${esc(r.card_type || '')}</td>
            <td>${esc(r.card_brand || '')}</td>
            <td class="num">${Number(r.bank_mdr_percent).toFixed(2)}%</td>
            <td class="num">${inr(r.bank_mdr_amount)}</td>
            <td>${esc(r.status)}</td>
          </tr>`).join('')
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Reimbursement Invoices</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI',Arial,sans-serif;padding:24px;color:#1F2937;font-size:10px}
  h1{font-size:18px;color:#6D28D9;margin-bottom:4px}
  .meta{color:#6B7280;font-size:10px;margin-bottom:14px}
  .totals{display:flex;gap:16px;margin-bottom:14px}
  .totals .card{background:#F5F3FF;border:1px solid #C4B5FD;border-radius:6px;padding:8px 12px}
  .totals .label{font-size:9px;color:#6B7280;text-transform:uppercase}
  .totals .value{font-size:14px;font-weight:700;color:#5B21B6}
  table{width:100%;border-collapse:collapse;font-size:9px}
  th{background:#6D28D9;color:#fff;padding:5px 6px;text-align:left}
  th.num,td.num{text-align:right}
  td{padding:4px 6px;border-bottom:1px solid #F3F4F6}
  tr:nth-child(even) td{background:#F9FAFB}
  .footer{margin-top:16px;text-align:center;font-size:9px;color:#9CA3AF}
  @page{size:A4 landscape;margin:8mm}
</style></head><body>
  <h1>Reimbursement Invoices</h1>
  <div class="meta">Generated ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} · ${allRows.length} record(s)</div>
  <div class="totals">
    <div class="card"><div class="label">Total Transaction Value</div><div class="value">${inr(totalAmount)}</div></div>
    <div class="card"><div class="label">Total Bank MDR</div><div class="value">${inr(totalMdr)}</div></div>
  </div>
  <table>
    <thead><tr>
      <th>Invoice No</th><th>Date</th><th>Brand</th><th>TID</th><th class="num">Txn Amount</th>
      <th>Mode</th><th>Card Type</th><th>Card Brand</th><th class="num">MDR %</th><th class="num">MDR ₹</th><th>Status</th>
    </tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <div class="footer">Same Day Solution — System Generated CA Reimbursement Report © ${new Date().getFullYear()}</div>
</body></html>`

        const pdf = await htmlToPdf(html, { landscape: true })

        if (format === 'pdf') {
          if (!pdf) {
            return new NextResponse(html, {
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Disposition': `attachment; filename="reimbursement-invoices-${fileDate}.html"`,
              },
            })
          }
          return new NextResponse(new Uint8Array(pdf), {
            headers: {
              'Content-Type': 'application/pdf',
              'Content-Disposition': `attachment; filename="reimbursement-invoices-${fileDate}.pdf"`,
            },
          })
        }

        // ZIP: CSV + PDF (or HTML fallback) together
        const zip = new JSZip()
        zip.file(`reimbursement-invoices-${fileDate}.csv`, buildCsv())
        if (pdf) zip.file(`reimbursement-invoices-${fileDate}.pdf`, new Uint8Array(pdf))
        else zip.file(`reimbursement-invoices-${fileDate}.html`, html)
        const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
        return new NextResponse(new Uint8Array(zipBuf), {
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="reimbursement-invoices-${fileDate}.zip"`,
          },
        })
      }

      if (format === 'excel') {
        const xmlRows = allRows.map((r: any) => `<Row>
          <Cell><Data ss:Type="String">${esc(r.invoice_number)}</Data></Cell>
          <Cell><Data ss:Type="String">${esc(r.transaction_date)}</Data></Cell>
          <Cell><Data ss:Type="String">${esc(r.brands?.name || '')}</Data></Cell>
          <Cell><Data ss:Type="String">${esc(r.tid)}</Data></Cell>
          <Cell><Data ss:Type="Number">${Number(r.transaction_amount).toFixed(2)}</Data></Cell>
          <Cell><Data ss:Type="String">${esc(r.payment_mode || '')}</Data></Cell>
          <Cell><Data ss:Type="String">${esc(r.card_type || '')}</Data></Cell>
          <Cell><Data ss:Type="Number">${Number(r.bank_mdr_percent).toFixed(4)}</Data></Cell>
          <Cell><Data ss:Type="Number">${Number(r.bank_mdr_amount).toFixed(2)}</Data></Cell>
          <Cell><Data ss:Type="String">${esc(r.status)}</Data></Cell>
        </Row>`).join('\n')

        const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="Reimbursement Invoices">
    <Table>
      <Row>
        <Cell><Data ss:Type="String">Invoice No</Data></Cell>
        <Cell><Data ss:Type="String">Date</Data></Cell>
        <Cell><Data ss:Type="String">Brand</Data></Cell>
        <Cell><Data ss:Type="String">TID</Data></Cell>
        <Cell><Data ss:Type="String">Transaction Amount (₹)</Data></Cell>
        <Cell><Data ss:Type="String">Payment Mode</Data></Cell>
        <Cell><Data ss:Type="String">Card Type</Data></Cell>
        <Cell><Data ss:Type="String">Bank MDR %</Data></Cell>
        <Cell><Data ss:Type="String">Bank MDR Amount (₹)</Data></Cell>
        <Cell><Data ss:Type="String">Status</Data></Cell>
      </Row>
      ${xmlRows}
    </Table>
  </Worksheet>
</Workbook>`

        return new NextResponse(xml, {
          headers: {
            'Content-Type': 'application/vnd.ms-excel',
            'Content-Disposition': `attachment; filename="reimbursement-invoices-${fileDate}.xls"`,
          },
        })
      }
    }

    // Paginated list
    const from = (page - 1) * limit
    const { data, error, count } = await buildQuery().range(from, from + limit - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({
      success: true,
      invoices: data || [],
      total: count ?? 0,
      page,
      limit,
      total_pages: Math.ceil((count ?? 0) / limit),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
