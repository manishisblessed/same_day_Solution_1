import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { htmlToPdf } from '@/lib/pdf/html-to-pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function requireCA(request: NextRequest) {
  const { user } = await getCurrentUserWithFallback(request)
  if (!user) return { error: 'Session expired. Please login again.', status: 401 as const }
  if (user.role !== 'ca_executive' && user.role !== 'admin') {
    return { error: 'CA access required', status: 403 as const }
  }
  return { user }
}

const INR = (n: number) =>
  '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const pct = (n: number) => `${Number(n).toFixed(2)}%`

function esc(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** GET /api/ca/transaction-invoices/[id]/export?format=pdf|excel|csv */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireCA(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const format = request.nextUrl.searchParams.get('format') || 'pdf'

  try {
    const supabase = getSupabaseAdmin()
    const { data: inv, error } = await supabase
      .from('ca_transaction_invoices')
      .select(`*, brands:brand_id ( id, key, name, short_name )`)
      .eq('id', params.id)
      .single()

    if (error || !inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    const brandName = (inv as any).brands?.name || 'Unknown Brand'
    const brandShort = (inv as any).brands?.short_name || ''
    const breakdown: any[] = (inv as any).breakdown || []
    const generatedAt = new Date((inv as any).generated_at || (inv as any).created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    const fileSlug = `${(inv as any).invoice_number}`

    // ── CSV ───────────────────────────────────────────────────────────────────
    if (format === 'csv') {
      const summaryLines = [
        ['Invoice Number', (inv as any).invoice_number],
        ['Brand', brandName],
        ['Period', `${(inv as any).period_start} to ${(inv as any).period_end}`],
        ['Transaction Count', (inv as any).txn_count],
        ['Total Transaction Value', Number((inv as any).total_transaction_value).toFixed(2)],
        ['Bank MDR Total (₹)', Number((inv as any).bank_mdr_total).toFixed(2)],
        [`Margin (${pct((inv as any).margin_percent)})`, Number((inv as any).margin_amount).toFixed(2)],
        ['Service Charge Total (₹)', Number((inv as any).service_charge_total).toFixed(2)],
        [`GST (${pct((inv as any).gst_percent)})`, Number((inv as any).gst_amount).toFixed(2)],
        ['Total with GST (₹)', Number((inv as any).total_with_gst).toFixed(2)],
        ['Status', (inv as any).status],
        ['Generated At', generatedAt],
        [],
        ['--- Per-TID Breakdown ---'],
        ['TID', 'Payment Mode', 'Txn Count', 'Transaction Value (₹)', 'Bank MDR %', 'Bank MDR Amount (₹)'],
        ...breakdown.map((b) => [
          b.tid, b.payment_mode, b.txn_count,
          Number(b.transaction_value).toFixed(2),
          Number(b.bank_mdr_percent).toFixed(4),
          Number(b.bank_mdr_amount).toFixed(2),
        ]),
      ]

      const csv = summaryLines
        .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
        .join('\n')

      return new NextResponse('\uFEFF' + csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${fileSlug}.csv"`,
        },
      })
    }

    // ── Excel ─────────────────────────────────────────────────────────────────
    if (format === 'excel') {
      const summaryRows = [
        ['Invoice Number', (inv as any).invoice_number],
        ['Brand', brandName],
        ['Period', `${(inv as any).period_start} to ${(inv as any).period_end}`],
        ['Transaction Count', (inv as any).txn_count],
        ['Total Transaction Value (₹)', Number((inv as any).total_transaction_value)],
        ['Bank MDR Total (₹)', Number((inv as any).bank_mdr_total)],
        [`Margin (${pct((inv as any).margin_percent)}) (₹)`, Number((inv as any).margin_amount)],
        ['Service Charge Total (₹)', Number((inv as any).service_charge_total)],
        [`GST @ ${pct((inv as any).gst_percent)} (₹)`, Number((inv as any).gst_amount)],
        ['Total with GST (₹)', Number((inv as any).total_with_gst)],
        ['Status', (inv as any).status],
        ['Generated At', generatedAt],
      ]

      const summaryXml = summaryRows.map(([label, value]) => `
        <Row>
          <Cell ss:StyleID="bold"><Data ss:Type="String">${esc(label)}</Data></Cell>
          <Cell><Data ss:Type="${typeof value === 'number' ? 'Number' : 'String'}">${esc(value)}</Data></Cell>
        </Row>`).join('')

      const breakdownXml = breakdown.map((b) => `
        <Row>
          <Cell><Data ss:Type="String">${esc(b.tid)}</Data></Cell>
          <Cell><Data ss:Type="String">${esc(b.payment_mode)}</Data></Cell>
          <Cell><Data ss:Type="Number">${b.txn_count}</Data></Cell>
          <Cell><Data ss:Type="Number">${Number(b.transaction_value).toFixed(2)}</Data></Cell>
          <Cell><Data ss:Type="Number">${Number(b.bank_mdr_percent).toFixed(4)}</Data></Cell>
          <Cell><Data ss:Type="Number">${Number(b.bank_mdr_amount).toFixed(2)}</Data></Cell>
        </Row>`).join('')

      const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="bold"><Font ss:Bold="1"/></Style>
    <Style ss:ID="hdr"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#6D28D9" ss:Pattern="Solid"/></Style>
  </Styles>
  <Worksheet ss:Name="Summary">
    <Table>${summaryXml}</Table>
  </Worksheet>
  <Worksheet ss:Name="Per-TID Breakdown">
    <Table>
      <Row>
        <Cell ss:StyleID="hdr"><Data ss:Type="String">TID</Data></Cell>
        <Cell ss:StyleID="hdr"><Data ss:Type="String">Payment Mode</Data></Cell>
        <Cell ss:StyleID="hdr"><Data ss:Type="String">Txn Count</Data></Cell>
        <Cell ss:StyleID="hdr"><Data ss:Type="String">Transaction Value (₹)</Data></Cell>
        <Cell ss:StyleID="hdr"><Data ss:Type="String">Bank MDR %</Data></Cell>
        <Cell ss:StyleID="hdr"><Data ss:Type="String">Bank MDR Amount (₹)</Data></Cell>
      </Row>
      ${breakdownXml}
    </Table>
  </Worksheet>
</Workbook>`

      return new NextResponse(xml, {
        headers: {
          'Content-Type': 'application/vnd.ms-excel',
          'Content-Disposition': `attachment; filename="${fileSlug}.xls"`,
        },
      })
    }

    // ── PDF ───────────────────────────────────────────────────────────────────
    const breakdownRows = breakdown.map((b) => `
      <tr>
        <td>${esc(b.tid)}</td>
        <td>${esc(b.payment_mode)}</td>
        <td class="num">${b.txn_count}</td>
        <td class="num">${INR(b.transaction_value)}</td>
        <td class="num">${pct(b.bank_mdr_percent)}</td>
        <td class="num">${INR(b.bank_mdr_amount)}</td>
      </tr>`).join('')

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${esc((inv as any).invoice_number)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; padding: 32px; color: #1F2937; font-size: 12px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #6D28D9; padding-bottom: 16px; margin-bottom: 24px; }
  .brand-block h1 { font-size: 22px; color: #6D28D9; font-weight: 700; }
  .brand-block p { color: #6B7280; font-size: 11px; margin-top: 2px; }
  .inv-block { text-align: right; }
  .inv-block .inv-no { font-size: 14px; font-weight: 700; color: #374151; }
  .inv-block p { color: #6B7280; font-size: 11px; margin-top: 2px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; background: #EDE9FE; color: #5B21B6; margin-top: 6px; }
  .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
  .summary-card { background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 12px; }
  .summary-card .label { font-size: 10px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .summary-card .value { font-size: 18px; font-weight: 700; color: #1F2937; }
  .highlight { background: #EDE9FE; border-color: #C4B5FD; }
  .highlight .value { color: #5B21B6; }
  .section-title { font-size: 13px; font-weight: 700; color: #374151; margin-bottom: 8px; margin-top: 20px; border-bottom: 1px solid #E5E7EB; padding-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { background: #6D28D9; color: #fff; padding: 7px 8px; text-align: left; font-weight: 600; }
  th.num, td.num { text-align: right; }
  td { padding: 6px 8px; border-bottom: 1px solid #F3F4F6; }
  tr:nth-child(even) td { background: #F9FAFB; }
  .gst-table { margin-top: 20px; }
  .gst-table table { max-width: 420px; margin-left: auto; }
  .gst-table tr td:first-child { font-weight: 600; color: #374151; }
  .gst-table tr.total td { background: #6D28D9; color: #fff; font-size: 13px; font-weight: 700; }
  .footer { margin-top: 30px; text-align: center; font-size: 10px; color: #9CA3AF; border-top: 1px solid #E5E7EB; padding-top: 10px; }
  @media print { body { padding: 16px; } @page { size: A4; margin: 10mm; } }
</style></head>
<body>
  <div class="header">
    <div class="brand-block">
      <h1>${esc(brandName)}</h1>
      <p>GST Transaction Invoice</p>
      <p>Period: ${(inv as any).period_start} to ${(inv as any).period_end}</p>
    </div>
    <div class="inv-block">
      <div class="inv-no">${esc((inv as any).invoice_number)}</div>
      <p>Generated: ${generatedAt}</p>
      <p>Transactions: ${(inv as any).txn_count}</p>
      <span class="badge">${(inv as any).status}</span>
    </div>
  </div>

  <div class="summary">
    <div class="summary-card">
      <div class="label">Total Transaction Value</div>
      <div class="value">${INR((inv as any).total_transaction_value)}</div>
    </div>
    <div class="summary-card">
      <div class="label">Bank MDR Total</div>
      <div class="value">${INR((inv as any).bank_mdr_total)}</div>
    </div>
    <div class="summary-card">
      <div class="label">Margin (${pct((inv as any).margin_percent)})</div>
      <div class="value">${INR((inv as any).margin_amount)}</div>
    </div>
    <div class="summary-card highlight">
      <div class="label">GST Output Tax (GSTR-1) @ ${pct((inv as any).gst_percent)}</div>
      <div class="value">${INR((inv as any).gst_amount)}</div>
    </div>
  </div>

  <div class="section-title">Per-TID Transaction Breakdown</div>
  <table>
    <thead>
      <tr>
        <th>TID</th>
        <th>Payment Mode</th>
        <th class="num">Txn Count</th>
        <th class="num">Transaction Value</th>
        <th class="num">Bank MDR %</th>
        <th class="num">Bank MDR Amount</th>
      </tr>
    </thead>
    <tbody>${breakdownRows}</tbody>
  </table>

  <div class="gst-table">
    <div class="section-title">Invoice Summary</div>
    <table>
      <tbody>
        <tr><td>Bank MDR Total</td><td class="num">${INR((inv as any).bank_mdr_total)}</td></tr>
        <tr><td>Company Margin @ ${pct((inv as any).margin_percent)}</td><td class="num">${INR((inv as any).margin_amount)}</td></tr>
        <tr><td><strong>Service Charge Total</strong></td><td class="num"><strong>${INR((inv as any).service_charge_total)}</strong></td></tr>
        <tr><td>GST @ ${pct((inv as any).gst_percent)}</td><td class="num">${INR((inv as any).gst_amount)}</td></tr>
        <tr class="total"><td>Total with GST</td><td class="num">${INR((inv as any).total_with_gst)}</td></tr>
      </tbody>
    </table>
  </div>

  <div class="footer">Same Day Solution &mdash; System Generated CA Invoice &copy; ${new Date().getFullYear()}</div>
</body></html>`

    const pdf = await htmlToPdf(html, { landscape: false })
    if (pdf) {
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${fileSlug}.pdf"`,
        },
      })
    }

    // Fallback: return HTML if PDF generation fails
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileSlug}.html"`,
      },
    })
  } catch (err: any) {
    console.error('[ca/transaction-invoices/export]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
