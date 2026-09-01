import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'
import {
  generateCSVResponse,
  generateExcelResponse,
  generatePDFResponse,
  type ReportColumn,
  type ReportMeta,
} from '@/lib/reports/generator'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const money = (n: number | string) =>
  `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

/**
 * GET /api/admin/partner-invoices/[id]/export?format=pdf|excel|csv
 * Exports the invoice statement (headline totals + MDR breakdown + settlements).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const { id } = await params
    const format = (request.nextUrl.searchParams.get('format') || 'pdf').toLowerCase()

    const { data: invoice, error } = await supabaseAdmin
      .from('partner_invoices')
      .select('*, partners(name, business_name, email, phone, gst_number)')
      .eq('id', id)
      .single()
    if (error || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const { data: settlements } = await supabaseAdmin
      .from('partner_invoice_settlements')
      .select('*')
      .eq('invoice_id', id)
      .order('settled_on', { ascending: true })

    const partner = (invoice as any).partners || {}
    const breakdown: any[] = Array.isArray(invoice.breakdown) ? invoice.breakdown : []

    const columns: ReportColumn[] = [
      { header: 'Mode', key: 'payment_mode', type: 'string' },
      { header: 'Card Type', key: 'card_type', type: 'string' },
      { header: 'Brand', key: 'card_brand', type: 'string' },
      { header: 'Txns', key: 'txn_count', type: 'number' },
      { header: 'Gross', key: 'gross', type: 'currency' },
      { header: 'MDR', key: 'mdr', type: 'currency' },
      { header: 'Net', key: 'net', type: 'currency' },
    ]

    const meta: ReportMeta = {
      title: `Invoice ${invoice.invoice_number}`,
      subtitle: partner.name || '',
      generatedBy: `${partner.name || 'Partner'}${partner.gst_number ? ` · GST ${partner.gst_number}` : ''}`,
      dateRange: { from: fmtDate(invoice.period_start), to: fmtDate(invoice.period_end) },
      summaryCards: [
        { label: 'Transaction Value', value: money(invoice.transaction_value) },
        { label: 'Txns', value: String(invoice.txn_count) },
        { label: 'Service Charge (MDR)', value: money(invoice.service_charge) },
        { label: 'Net Payable', value: money(invoice.net_payable) },
        { label: 'Settled', value: money(invoice.amount_settled) },
        { label: 'Balance Due', value: money(invoice.balance_due) },
      ],
    }

    const fileName = `${invoice.invoice_number}`

    if (format === 'csv') {
      // Include a settlements section beneath the breakdown for CSV.
      const rows = [
        ...breakdown,
        {},
        { payment_mode: 'SETTLEMENTS', card_type: 'Date', card_brand: 'Method', txn_count: 'Account', gross: 'UTR/Ref', mdr: 'Amount', net: '' },
        ...(settlements || []).map((s: any) => ({
          payment_mode: '',
          card_type: fmtDate(s.settled_on),
          card_brand: s.method,
          txn_count: s.bank_account || '',
          gross: s.utr_reference || '',
          mdr: money(s.amount),
          net: '',
        })),
      ]
      return generateCSVResponse(rows, columns, fileName, meta)
    }

    if (format === 'excel' || format === 'xls' || format === 'xlsx') {
      return generateExcelResponse(breakdown, columns, fileName, 'Invoice')
    }

    // Default: PDF
    return await generatePDFResponse(breakdown, columns, fileName, meta, { accentColor: '#4F46E5' })
  } catch (error: any) {
    console.error('[Partner Invoice Export] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
