import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

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

/** GET /api/ca/transaction-invoices?brand_id=&status=&year=&month= */
export async function GET(request: NextRequest) {
  const auth = await requireCA(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const sp = request.nextUrl.searchParams
    const brandId = sp.get('brand_id')?.trim()
    const status = sp.get('status')?.trim()
    const year = sp.get('year')?.trim()
    const month = sp.get('month')?.trim()
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10))
    const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') || '50', 10)))

    const supabase = getSupabaseAdmin()

    let q = supabase
      .from('ca_transaction_invoices')
      .select(`*, brands:brand_id ( id, key, name, short_name )`, { count: 'exact' })
      .order('period_start', { ascending: false })

    if (brandId) q = q.eq('brand_id', brandId)
    if (status) q = q.eq('status', status)
    if (year && month) {
      const ym = `${year}-${String(month).padStart(2, '0')}`
      q = q.gte('period_start', `${ym}-01`).lte('period_start', `${ym}-31`)
    } else if (year) {
      q = q.gte('period_start', `${year}-01-01`).lte('period_start', `${year}-12-31`)
    }

    const from = (page - 1) * limit
    const { data, error, count } = await q.range(from, from + limit - 1)
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

/**
 * POST /api/ca/transaction-invoices/generate
 * Body: { brand_id, year, month, notes?, regenerate? }
 *
 * Aggregates all issued reimbursement invoices for the period,
 * computes margin + GST, and creates/replaces the Transaction Invoice.
 */
export async function POST(request: NextRequest) {
  const auth = await requireCA(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const brand_id = String(body.brand_id || '').trim()
    const year = parseInt(body.year, 10)
    const month = parseInt(body.month, 10)

    if (!brand_id) return NextResponse.json({ error: 'brand_id is required' }, { status: 400 })
    if (!year || year < 2020 || year > 2100) return NextResponse.json({ error: 'Valid year is required' }, { status: 400 })
    if (!month || month < 1 || month > 12) return NextResponse.json({ error: 'month must be 1-12' }, { status: 400 })

    const supabase = getSupabaseAdmin()

    // Period bounds
    const period_start = `${year}-${String(month).padStart(2, '0')}-01`
    const lastDay = new Date(year, month, 0).getDate()
    const period_end = `${year}-${String(month).padStart(2, '0')}-${lastDay}`

    // Check if already exists
    const { data: existing } = await supabase
      .from('ca_transaction_invoices')
      .select('id, status')
      .eq('brand_id', brand_id)
      .eq('period_start', period_start)
      .eq('period_end', period_end)
      .maybeSingle()

    if (existing && !body.regenerate) {
      if (existing.status === 'filed') {
        return NextResponse.json({ error: 'This invoice has already been filed. Use regenerate=true to override.' }, { status: 409 })
      }
    }

    // Get company config (margin %)
    const { data: companyConfig } = await supabase
      .from('ca_company_config')
      .select('margin_percent, gst_percent')
      .eq('brand_id', brand_id)
      .maybeSingle()

    const margin_percent = Number(companyConfig?.margin_percent ?? 20)
    const gst_percent = Number(companyConfig?.gst_percent ?? 18)

    // Aggregate reimbursement invoices for this brand + period
    const { data: reimbs, error: reimbErr } = await supabase
      .from('ca_reimbursement_invoices')
      .select('tid, transaction_amount, bank_mdr_percent, bank_mdr_amount, payment_mode, transaction_date')
      .eq('brand_id', brand_id)
      .eq('status', 'issued')
      .gte('transaction_date', period_start)
      .lte('transaction_date', period_end)

    if (reimbErr) return NextResponse.json({ error: reimbErr.message }, { status: 400 })

    const rows = reimbs || []
    const txn_count = rows.length
    const total_transaction_value = rows.reduce((s: number, r: any) => s + Number(r.transaction_amount), 0)
    const bank_mdr_total = rows.reduce((s: number, r: any) => s + Number(r.bank_mdr_amount), 0)

    const margin_amount = Math.round(bank_mdr_total * margin_percent) / 100
    const service_charge_total = Math.round((bank_mdr_total + margin_amount) * 100) / 100
    const gst_amount = Math.round(service_charge_total * gst_percent) / 100
    const total_with_gst = Math.round((service_charge_total + gst_amount) * 100) / 100

    // Per-TID breakdown
    const tidMap: Record<string, { txn_count: number; transaction_value: number; bank_mdr_amount: number; bank_mdr_percent: number; payment_mode: string }> = {}
    for (const r of rows) {
      const key = r.tid || 'NO-TID (Soundbox/QR)'
      if (!tidMap[key]) {
        tidMap[key] = { txn_count: 0, transaction_value: 0, bank_mdr_amount: 0, bank_mdr_percent: Number(r.bank_mdr_percent), payment_mode: r.payment_mode || '*' }
      }
      tidMap[key].txn_count++
      tidMap[key].transaction_value += Number(r.transaction_amount)
      tidMap[key].bank_mdr_amount += Number(r.bank_mdr_amount)
    }
    const breakdown = Object.entries(tidMap).map(([tid, v]) => ({ tid, ...v, transaction_value: Math.round(v.transaction_value * 100) / 100, bank_mdr_amount: Math.round(v.bank_mdr_amount * 100) / 100 }))

    // Generate invoice number
    const { data: invNumData } = await supabase.rpc('ca_next_txninv_number', { p_brand_id: brand_id, p_year: year, p_month: month })
    const invoice_number = invNumData || `TXNINV-${brand_id.slice(0, 8)}-${year}-${String(month).padStart(2, '0')}-001`

    const invoiceRow = {
      invoice_number: existing ? existing.id : invoice_number, // keep number on regen
      brand_id,
      period_start,
      period_end,
      txn_count,
      total_transaction_value: Math.round(total_transaction_value * 100) / 100,
      bank_mdr_total: Math.round(bank_mdr_total * 100) / 100,
      margin_percent,
      margin_amount: Math.round(margin_amount * 100) / 100,
      service_charge_total,
      gst_percent,
      gst_amount: Math.round(gst_amount * 100) / 100,
      total_with_gst,
      breakdown,
      status: 'draft',
      notes: body.notes ? String(body.notes).trim() : null,
      generated_at: new Date().toISOString(),
      created_by: auth.user.email,
    }

    let result: any
    if (existing) {
      // Re-generate: update existing row, preserve invoice_number
      const { data, error } = await supabase
        .from('ca_transaction_invoices')
        .update({
          ...invoiceRow,
          invoice_number: undefined, // don't change the number
          status: existing.status === 'filed' ? 'draft' : existing.status,
        })
        .eq('id', existing.id)
        .select(`*, brands:brand_id ( id, key, name, short_name )`)
        .single()
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      result = data
    } else {
      const { data, error } = await supabase
        .from('ca_transaction_invoices')
        .insert(invoiceRow)
        .select(`*, brands:brand_id ( id, key, name, short_name )`)
        .single()
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      result = data
    }

    // Stamp every reimbursement row in this brand+period with the GST invoice id
    let linked_count = 0
    try {
      const { data: linkData } = await supabase.rpc('ca_link_reimbursements_to_txninv', {
        p_txninv_id: result.id,
        p_brand_id: brand_id,
        p_period_start: period_start,
        p_period_end: period_end,
      })
      linked_count = Number(linkData ?? 0)
    } catch (linkErr: any) {
      // Non-fatal: invoice is still created, just log
      console.warn('[ca_link_reimbursements_to_txninv]', linkErr?.message || linkErr)
    }

    return NextResponse.json(
      { success: true, invoice: result, linked_reimbursements: linked_count },
      { status: existing ? 200 : 201 },
    )
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
