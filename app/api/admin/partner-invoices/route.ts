import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'
import { computePartnerInvoice, buildInvoiceNumber } from '@/lib/partner-invoice/generate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/partner-invoices
 * List invoices with optional filters: partner_id, status, search (invoice no /
 * partner name), page, page_size.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 })
    }

    const sp = request.nextUrl.searchParams
    const partnerId = sp.get('partner_id')
    const status = sp.get('status')
    const search = sp.get('search')?.trim()
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('page_size') || '20', 10) || 20))
    const offset = (page - 1) * pageSize

    let query = supabaseAdmin
      .from('partner_invoices')
      .select('*, partners(name, business_name)', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (partnerId) query = query.eq('partner_id', partnerId)
    if (status) query = query.eq('status', status)
    if (search) query = query.ilike('invoice_number', `%${search}%`)

    const { data, error, count } = await query.range(offset, offset + pageSize - 1)
    if (error) throw new Error(error.message)

    const rows = (data || []).map((r: any) => ({
      ...r,
      partner_name: r.partners?.name || null,
      partner_business_name: r.partners?.business_name || null,
      partners: undefined,
    }))

    // Headline stats across the (unpaginated) filtered set
    let statsQuery = supabaseAdmin.from('partner_invoices').select('net_payable, amount_settled, balance_due')
    if (partnerId) statsQuery = statsQuery.eq('partner_id', partnerId)
    if (status) statsQuery = statsQuery.eq('status', status)
    if (search) statsQuery = statsQuery.ilike('invoice_number', `%${search}%`)
    const { data: statsRows } = await statsQuery

    const stats = (statsRows || []).reduce(
      (acc: { net: number; settled: number; due: number }, r: any) => {
        acc.net += Number(r.net_payable) || 0
        acc.settled += Number(r.amount_settled) || 0
        acc.due += Number(r.balance_due) || 0
        return acc
      },
      { net: 0, settled: 0, due: 0 }
    )

    return NextResponse.json({
      success: true,
      data: rows,
      stats,
      pagination: {
        page,
        page_size: pageSize,
        total: count || 0,
        total_pages: count ? Math.ceil(count / pageSize) : 0,
      },
    })
  } catch (error: any) {
    console.error('[Partner Invoices GET] Error:', error)
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/admin/partner-invoices
 * Generate (or preview) an invoice for a partner + period.
 * Body: { partner_id, period_start (YYYY-MM-DD), period_end (YYYY-MM-DD), preview?, notes? }
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { partner_id, period_start, period_end, preview, notes } = body

    if (!partner_id || !period_start || !period_end) {
      return NextResponse.json(
        { success: false, error: 'partner_id, period_start and period_end are required' },
        { status: 400 }
      )
    }
    if (new Date(period_start) > new Date(period_end)) {
      return NextResponse.json({ success: false, error: 'period_start must be on or before period_end' }, { status: 400 })
    }

    const { data: partner, error: partnerErr } = await supabaseAdmin
      .from('partners')
      .select('id, name, business_name, status')
      .eq('id', partner_id)
      .single()
    if (partnerErr || !partner) {
      return NextResponse.json({ success: false, error: 'Partner not found' }, { status: 404 })
    }

    const computation = await computePartnerInvoice(partner_id, period_start, period_end)

    // Preview mode: compute and return without persisting
    if (preview) {
      return NextResponse.json({ success: true, preview: true, data: { ...computation, partner_name: partner.name } })
    }

    const invoiceNumber = buildInvoiceNumber(partner.name, period_start)

    const payload = {
      invoice_number: invoiceNumber,
      partner_id,
      period_start,
      period_end,
      transaction_value: computation.transaction_value,
      txn_count: computation.txn_count,
      service_charge: computation.service_charge,
      net_payable: computation.net_payable,
      breakdown: computation.breakdown,
      notes: notes || null,
      status: 'draft',
      generated_at: new Date().toISOString(),
      created_by: user.email,
    }

    // Upsert on the (partner, period) unique key so re-running refreshes totals
    // for a draft/issued invoice without creating duplicates.
    const { data: existing } = await supabaseAdmin
      .from('partner_invoices')
      .select('id, status')
      .eq('partner_id', partner_id)
      .eq('period_start', period_start)
      .eq('period_end', period_end)
      .maybeSingle()

    if (existing) {
      if (existing.status === 'settled' || existing.status === 'void') {
        return NextResponse.json(
          { success: false, error: `An invoice for this period already exists and is ${existing.status}.` },
          { status: 409 }
        )
      }
      const { data: updated, error: updErr } = await supabaseAdmin
        .from('partner_invoices')
        .update({
          transaction_value: payload.transaction_value,
          txn_count: payload.txn_count,
          service_charge: payload.service_charge,
          net_payable: payload.net_payable,
          breakdown: payload.breakdown,
          generated_at: payload.generated_at,
        })
        .eq('id', existing.id)
        .select()
        .single()
      if (updErr) throw new Error(updErr.message)
      return NextResponse.json({ success: true, data: updated, regenerated: true })
    }

    const { data: created, error: insErr } = await supabaseAdmin
      .from('partner_invoices')
      .insert(payload)
      .select()
      .single()
    if (insErr) throw new Error(insErr.message)

    return NextResponse.json({ success: true, data: created })
  } catch (error: any) {
    console.error('[Partner Invoices POST] Error:', error)
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 })
  }
}
