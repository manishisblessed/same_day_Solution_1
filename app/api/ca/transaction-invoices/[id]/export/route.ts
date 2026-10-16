import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { htmlToPdf } from '@/lib/pdf/html-to-pdf'
import { invoiceCsv, invoicesHtmlDoc, invoiceMeta, pct, esc } from '@/lib/ca/transaction-invoice-export'

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

    const { brandName, breakdown, generatedAt } = invoiceMeta(inv as any)
    const fileSlug = `${(inv as any).invoice_number}`

    // ── CSV ───────────────────────────────────────────────────────────────────
    if (format === 'csv') {
      return new NextResponse(invoiceCsv(inv as any), {
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
    const html = invoicesHtmlDoc([inv as any], (inv as any).invoice_number)

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
