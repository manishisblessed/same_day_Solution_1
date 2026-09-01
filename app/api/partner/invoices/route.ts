import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError } from '@/lib/partner-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

/**
 * POST /api/partner/invoices
 *
 * Returns settlement invoices for the authenticated partner.
 *   - Without invoice_id: paginated list of the partner's invoices.
 *   - With invoice_id: full invoice detail incl. MDR breakdown + settlement log.
 *
 * Draft invoices are never exposed to partners (only issued and beyond).
 *
 * Authentication: HMAC-SHA256 headers (x-api-key, x-signature, x-timestamp).
 * Permission required: read
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Server configuration error' } },
        { status: 500 }
      )
    }

    let authResult
    try {
      authResult = await authenticatePartner(request)
    } catch (error) {
      const authError = error as PartnerAuthError
      return NextResponse.json(
        { success: false, error: { code: authError.code, message: authError.message } },
        { status: authError.status }
      )
    }
    const { partner } = authResult

    if (!partner.permissions.includes('read')) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions. "read" permission required.' } },
        { status: 403 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    let body: any = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }

    const { invoice_id, status, page = 1, page_size = 20 } = body

    // Detail mode
    if (invoice_id) {
      const { data: invoice } = await supabase
        .from('partner_invoices')
        .select('*')
        .eq('id', invoice_id)
        .eq('partner_id', partner.id)
        .neq('status', 'draft')
        .maybeSingle()

      if (!invoice) {
        return NextResponse.json(
          { success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found' } },
          { status: 404 }
        )
      }

      const { data: settlements } = await supabase
        .from('partner_invoice_settlements')
        .select('amount, settled_on, method, utr_reference, note, created_at')
        .eq('invoice_id', invoice_id)
        .order('settled_on', { ascending: false })

      return NextResponse.json({
        success: true,
        company: 'Same Day Solution',
        data: { ...invoice, settlements: settlements || [] },
      })
    }

    // List mode
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(page_size, 10) || 20))
    const offset = (pageNum - 1) * pageSizeNum

    let query = supabase
      .from('partner_invoices')
      .select(
        'id, invoice_number, period_start, period_end, transaction_value, txn_count, ' +
          'service_charge, net_payable, amount_settled, balance_due, status, generated_at, issued_at',
        { count: 'exact' }
      )
      .eq('partner_id', partner.id)
      .neq('status', 'draft')
      .order('period_start', { ascending: false })

    if (status && status !== 'draft') query = query.eq('status', status)

    const { data, count, error } = await query.range(offset, offset + pageSizeNum - 1)
    if (error) {
      console.error('[Partner Invoices API] Query error:', error)
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load invoices' } },
        { status: 500 }
      )
    }

    const totalRecords = count || 0
    const totalPages = totalRecords > 0 ? Math.ceil(totalRecords / pageSizeNum) : 0

    return NextResponse.json({
      success: true,
      company: 'Same Day Solution',
      data: data || [],
      pagination: {
        page: pageNum,
        page_size: pageSizeNum,
        total_records: totalRecords,
        total_pages: totalPages,
        has_next: pageNum < totalPages,
        has_prev: pageNum > 1,
      },
    })
  } catch (error: any) {
    console.error('Error in POST /api/partner/invoices:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
