import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
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

const VALID_STATUS = ['SUCCESS', 'FAILED', 'PENDING', 'AWAITING_APPROVAL', 'REJECTED'] as const
type SettlementStatus = (typeof VALID_STATUS)[number]

/**
 * POST /api/partner/settlement/status/bulk
 *
 * Bulk status of Settlement-2 (SHADVAL Pay) account transfers over a date range.
 * Built for partners (e.g. Equity Capital) to reconcile ALL account-transfer
 * transactions in one window instead of checking them one by one.
 *
 * Body:
 *   {
 *     "from_date": "2026-10-01",            // YYYY-MM-DD or ISO 8601 (required)
 *     "to_date":   "2026-10-14",            // YYYY-MM-DD or ISO 8601 (required)
 *     "page":       1,                       // optional, default 1
 *     "page_size":  100,                     // optional, default 50, max 200
 *     "status":    "SUCCESS"                 // optional: SUCCESS|FAILED|PENDING|AWAITING_APPROVAL|REJECTED
 *   }
 *
 * Status reflects the last-known state (kept current by the reconciliation cron
 * and settlement webhooks). For a live provider re-check of a single PENDING
 * transfer, use the single-txn endpoint (settlement/status?reference_id=...).
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
    const access = partnerCanUseApi(partner, 'settlement')
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

    let statusFilter: SettlementStatus | null = null
    if (body.status != null && String(body.status).trim() !== '') {
      const s = String(body.status).trim().toUpperCase() as SettlementStatus
      if (!VALID_STATUS.includes(s)) {
        return NextResponse.json(
          { success: false, error: { code: 'BAD_REQUEST', message: `Invalid status. One of: ${VALID_STATUS.join(', ')}` } },
          { status: 400 }
        )
      }
      statusFilter = s
    }

    const supabase = getSupabase()

    let query = supabase
      .from('shadval_settlement')
      .select(
        'id, reference_id, order_id, utr, amount, charges, total_debit, mode, status, status_message, account_number, ifsc_code, account_holder_name, created_at, provider_timestamp',
        { count: 'exact' }
      )
      .eq('retailer_id', partner.id)
      .gte('created_at', params.fromISO)
      .lte('created_at', params.toISO)

    if (statusFilter) query = query.eq('status', statusFilter)

    const { data: rows, error: queryErr, count } = await query
      .order('created_at', { ascending: false })
      .range(params.offset, params.offset + params.pageSize - 1)

    if (queryErr) {
      console.error('[Partner Settlement Bulk Status] Query error:', queryErr)
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to query transactions' } },
        { status: 500 }
      )
    }

    const transactions = (rows || []).map((t) => ({
      id: t.id,
      reference_id: t.reference_id,
      order_id: t.order_id,
      utr: t.utr,
      amount: t.amount,
      charges: t.charges,
      total_debited: t.total_debit,
      mode: t.mode,
      status: t.status,
      status_message: t.status_message,
      account_number: t.account_number,
      ifsc_code: t.ifsc_code,
      account_holder_name: t.account_holder_name,
      created_at: t.created_at,
      provider_timestamp: t.provider_timestamp,
    }))

    return NextResponse.json({
      success: true,
      service: 'settlement-2',
      from_date: params.fromISO,
      to_date: params.toISO,
      status_filter: statusFilter,
      pagination: buildPagination(params.page, params.pageSize, count ?? 0),
      count: transactions.length,
      transactions,
    })
  } catch (error: any) {
    console.error('[Partner Settlement Bulk Status] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
