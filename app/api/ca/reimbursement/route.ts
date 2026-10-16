import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import JSZip from 'jszip'
import { checkCompanyComplete, type CompanyConfig, type Receiver } from '@/lib/ca/company-invoice'
import { buildTaxInvoicesPdf, type InvoiceRender } from '@/lib/ca/invoice-pdf'

const MAX_INVOICE_FILES = 300

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
          partners:partner_id ( id, name, business_name, gst_number, pan_number, address, city, state, pincode, email, phone ),
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
    if (format === 'csv' || format === 'excel' || format === 'pdf' || format === 'zip' || format === 'data') {
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

      // Browser-side rendering path: return raw rows as JSON (no Puppeteer).
      if (format === 'data') {
        return NextResponse.json({ success: true, rows: allRows, count: allRows.length })
      }

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

      // PDF + ZIP → one formatted Tax Invoice document PER transaction.
      if (format === 'pdf' || format === 'zip') {
        if (allRows.length === 0) {
          return NextResponse.json({ error: 'No invoices match the current filters.' }, { status: 400 })
        }
        if (allRows.length > MAX_INVOICE_FILES) {
          return NextResponse.json(
            { error: `Too many invoices (${allRows.length}). Narrow the date range or brand (max ${MAX_INVOICE_FILES} per download).` },
            { status: 400 },
          )
        }

        // Load issuer company profiles for every brand in the result set.
        const brandIds = Array.from(new Set(allRows.map((r: any) => r.brand_id).filter(Boolean)))
        const { data: cfgRows } = await supabase
          .from('ca_company_config')
          .select('*, brands:brand_id ( id, key, name, short_name )')
          .in('brand_id', brandIds)
        const cfgMap = new Map<string, CompanyConfig>()
        for (const c of cfgRows || []) cfgMap.set(c.brand_id, c as CompanyConfig)

        // Completeness gate — block generation until each company profile is ready.
        const incomplete: string[] = []
        for (const bid of brandIds) {
          const cfg = cfgMap.get(bid)
          const { complete, missing } = checkCompanyComplete(cfg)
          if (!complete) {
            const name = cfg?.brands?.name || allRows.find((r: any) => r.brand_id === bid)?.brands?.name || bid
            incomplete.push(`${name} — ${missing.join(', ')}`)
          }
        }
        if (incomplete.length > 0) {
          return NextResponse.json(
            { error: `Complete the Company Details before generating invoices:\n• ${incomplete.join('\n• ')}` },
            { status: 400 },
          )
        }

        const toReceiver = (r: any): Receiver => ({
          name: r.partners?.business_name || r.partners?.name,
          address: [r.partners?.address, r.partners?.city, r.partners?.state, r.partners?.pincode].filter(Boolean).join(', '),
          gstin: r.partners?.gst_number,
          pan: r.partners?.pan_number,
          email: r.partners?.email,
          phone: r.partners?.phone,
          state: r.partners?.state,
        })

        // Pure-JS PDF (jsPDF) — one invoice per page. No headless browser, so it
        // works reliably on serverless (Amplify/Lambda).
        const items: InvoiceRender[] = allRows.map((r: any) => {
          const cfg = cfgMap.get(r.brand_id) as CompanyConfig
          return {
            company: cfg,
            receiver: toReceiver(r),
            inv: {
              invoiceNumber: r.invoice_number,
              date: r.transaction_date,
              taxableValue: Number(r.transaction_amount || 0),
              gstPercent: Number(cfg.gst_percent ?? 18),
              kind: 'Reimbursement Invoice',
            },
          }
        })
        const pdf = buildTaxInvoicesPdf(items)

        if (format === 'pdf') {
          return new NextResponse(new Uint8Array(pdf), {
            headers: {
              'Content-Type': 'application/pdf',
              'Content-Disposition': `attachment; filename="reimbursement-invoices-${fileDate}.pdf"`,
            },
          })
        }

        // ZIP → CSV list + the combined PDF invoices (both per current filter).
        const zip = new JSZip()
        zip.file(`reimbursement-invoices-${fileDate}.csv`, buildCsv())
        zip.file(`reimbursement-invoices-${fileDate}.pdf`, new Uint8Array(pdf))
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
