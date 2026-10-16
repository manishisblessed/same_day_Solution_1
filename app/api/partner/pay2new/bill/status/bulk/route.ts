import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { resolvePay2NewDebitStatesBatch, type Pay2NewDebitRow, type Pay2NewStatus } from '@/lib/pay2new/ledger-status'
import { parseBulkRange, buildPagination } from '@/lib/partner-api/bulk-query'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

const VALID_STATUS: Pay2NewStatus[] = ['SUCCESS', 'FAILED', 'PENDING', 'REFUNDED']

/**
 * POST /api/partner/pay2new/bill/status/bulk
 *
 * Bulk status of Pay2New (BBPS-2 Credit Card) bill payments over a date range.
 * Built for partners (e.g. Equity Capital) to reconcile ALL transactions in one
 * window instead of polling single-txn status one by one.
 *
 * Body:
 *   {
 *     "from_date": "2026-10-01",            // YYYY-MM-DD or ISO 8601 (required)
 *     "to_date":   "2026-10-14",            // YYYY-MM-DD or ISO 8601 (required)
 *     "page":       1,                       // optional, default 1
 *     "page_size":  100,                     // optional, default 50, max 200
 *     "status":    "SUCCESS"                 // optional: SUCCESS|FAILED|PENDING|REFUNDED
 *   }
 *
 * Status is resolved from the authoritative ledger state (recorded order id,
 * refund/clawback presence, failed flag). No per-row upstream call is made —
 * the reconciliation cron + webhooks keep PENDING rows current; use the
 * single-txn endpoint (bill/status) for a live provider re-check of one txn.
 *
 * NOTE on `status` filter + pagination: because Pay2New status is DERIVED (not a
 * single DB column), the filter is applied AFTER resolving the current page.
 * `pagination` therefore reflects the UNFILTERED range; iterate all pages (or
 * omit `status` and filter client-side) when you need exact filtered counts.
 */
export async function POST(request: NextRequest) {
  try {
    let authResult
    try {
      authResult = await authenticatePartner(request)
    } catch (error) {
      const e = error as PartnerAuthError
      return NextResponse.json(
        { success: false, error: { code: e.code, message: e.message } },
        { status: e.status }
      )
    }

    const { partner } = authResult

    // Dedicated gate: the Status / Reconciliation API must be explicitly enabled
    // for the partner (separate from the Pay2New service flag itself).
    const statusAccess = partnerCanUseApi(partner, 'status')
    if (!statusAccess.allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'STATUS_API_DISABLED', message: statusAccess.message } },
        { status: 403 }
      )
    }

    const access = partnerCanUseApi(partner, 'bbps2')
    if (!access.allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: access.message } },
        { status: 403 }
      )
    }

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
        { status: 400 }
      )
    }

    const { params, error: rangeErr } = parseBulkRange(body)
    if (rangeErr || !params) {
      return NextResponse.json({ success: false, error: rangeErr }, { status: 400 })
    }

    let statusFilter: Pay2NewStatus | null = null
    if (body.status != null && String(body.status).trim() !== '') {
      const s = String(body.status).trim().toUpperCase() as Pay2NewStatus
      if (!VALID_STATUS.includes(s)) {
        return NextResponse.json(
          { success: false, error: { code: 'BAD_REQUEST', message: `Invalid status. One of: ${VALID_STATUS.join(', ')}` } },
          { status: 400 }
        )
      }
      statusFilter = s
    }

    const supabase = getSupabase()

    const { data: rows, error: queryErr, count } = await supabase
      .from('partner_wallet_ledger')
      .select('id, reference_id, description, status, created_at, debit, bill_fetch_ref', { count: 'exact' })
      .eq('partner_id', partner.id)
      .eq('service_type', 'pay2new')
      .eq('transaction_type', 'DEBIT')
      .gte('created_at', params.fromISO)
      .lte('created_at', params.toISO)
      .order('created_at', { ascending: false })
      .range(params.offset, params.offset + params.pageSize - 1)

    if (queryErr) {
      console.error('[Partner Pay2New Bulk Status] Query error:', queryErr)
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to query transactions' } },
        { status: 500 }
      )
    }

    const debitRows = (rows || []) as Pay2NewDebitRow[]
    const resolved = await resolvePay2NewDebitStatesBatch(supabase, partner.id, debitRows)

    let items = resolved.map((r) => ({
      request_id: r.requestId,
      bill_fetch_ref: r.billFetchRef,
      order_id: r.orderId,
      status: r.status,
      amount: r.amount,
      charge: r.charge,
      operator_reference: r.operatorReference,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    }))

    if (statusFilter) {
      items = items.filter((i) => i.status === statusFilter)
    }

    return NextResponse.json({
      success: true,
      service: 'pay2new',
      from_date: params.fromISO,
      to_date: params.toISO,
      status_filter: statusFilter,
      pagination: buildPagination(params.page, params.pageSize, count ?? 0),
      count: items.length,
      transactions: items,
    })
  } catch (error: any) {
    console.error('[Partner Pay2New Bulk Status] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
