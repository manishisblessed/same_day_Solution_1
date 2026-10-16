import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { htmlToPdf } from '@/lib/pdf/html-to-pdf'
import JSZip from 'jszip'
import { invoicesHtmlDoc, invoicesListCsv } from '@/lib/ca/transaction-invoice-export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Cap how many invoices a single bulk export renders, to stay within request
// limits (each PDF is a headless-Chrome render).
const MAX_INVOICES = 200

async function requireCA(request: NextRequest) {
  const { user } = await getCurrentUserWithFallback(request)
  if (!user) return { error: 'Session expired. Please login again.', status: 401 as const }
  if (user.role !== 'ca_executive' && user.role !== 'admin') {
    return { error: 'CA access required', status: 403 as const }
  }
  return { user }
}

/**
 * GET /api/ca/transaction-invoices/export-all?format=csv|pdf|zip&brand_id=&status=&year=&month=
 *
 *  csv → one combined list CSV (one row per invoice)
 *  pdf → one merged PDF, one invoice per page
 *  zip → a .zip containing, for every invoice, {invoice_number}.csv + {invoice_number}.pdf,
 *        plus a combined all-invoices-summary.csv
 */
export async function GET(request: NextRequest) {
  const auth = await requireCA(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const sp = request.nextUrl.searchParams
  const format = (sp.get('format') || 'zip').toLowerCase()
  const brandId = sp.get('brand_id')?.trim()
  const status = sp.get('status')?.trim()
  const year = sp.get('year')?.trim()
  const month = sp.get('month')?.trim()

  try {
    const supabase = getSupabaseAdmin()
    let q = supabase
      .from('ca_transaction_invoices')
      .select(`*, brands:brand_id ( id, key, name, short_name )`)
      .order('period_start', { ascending: false })
      .limit(MAX_INVOICES)

    if (brandId) q = q.eq('brand_id', brandId)
    if (status) q = q.eq('status', status)
    if (year && month) {
      const ym = `${year}-${String(month).padStart(2, '0')}`
      q = q.gte('period_start', `${ym}-01`).lte('period_start', `${ym}-31`)
    } else if (year) {
      q = q.gte('period_start', `${year}-01-01`).lte('period_start', `${year}-12-31`)
    }

    const { data: invoices, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (!invoices || invoices.length === 0) {
      return NextResponse.json({ error: 'No invoices match the selected filters.' }, { status: 404 })
    }

    // Load issuer company profiles for every brand in the set.
    const brandIds = Array.from(new Set(invoices.map((i: any) => i.brand_id).filter(Boolean)))
    const { data: cfgRows } = await supabase
      .from('ca_company_config')
      .select('*, brands:brand_id ( id, key, name, short_name )')
      .in('brand_id', brandIds)
    const companyMap: Record<string, any> = {}
    for (const c of cfgRows || []) companyMap[c.brand_id] = c

    const fileDate = new Date().toISOString().split('T')[0]

    // ── Combined CSV ──────────────────────────────────────────────────────────
    if (format === 'csv') {
      return new NextResponse(invoicesListCsv(invoices), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="gst-invoices-${fileDate}.csv"`,
        },
      })
    }

    // ── Merged PDF (one invoice per page) ───────────────────────────────────────
    if (format === 'pdf') {
      const html = invoicesHtmlDoc(invoices, `GST Transaction Invoices (${invoices.length})`, companyMap)
      const pdf = await htmlToPdf(html, { landscape: false })
      if (!pdf) {
        return new NextResponse(html, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Disposition': `attachment; filename="gst-invoices-${fileDate}.html"`,
          },
        })
      }
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="gst-invoices-${fileDate}.pdf"`,
        },
      })
    }

    // ── ZIP: list CSV + one combined PDF (all invoices, one per page) ──────────
    // Single render keeps this well within serverless time limits.
    const zip = new JSZip()
    zip.file(`gst-invoices-${fileDate}.csv`, invoicesListCsv(invoices))
    const html = invoicesHtmlDoc(invoices, `GST Transaction Invoices (${invoices.length})`, companyMap)
    const pdf = await htmlToPdf(html, { landscape: false })
    if (pdf) zip.file(`gst-invoices-${fileDate}.pdf`, new Uint8Array(pdf))
    else zip.file(`gst-invoices-${fileDate}.html`, html)

    const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    return new NextResponse(new Uint8Array(zipBuf), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="gst-invoices-${fileDate}.zip"`,
      },
    })
  } catch (err: any) {
    console.error('[ca/transaction-invoices/export-all]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
