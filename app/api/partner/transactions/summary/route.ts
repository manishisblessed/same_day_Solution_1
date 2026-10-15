import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { resolvePay2NewDebitStatesBatch, type Pay2NewDebitRow, type Pay2NewStatus } from '@/lib/pay2new/ledger-status'
import { parseBulkRange } from '@/lib/partner-api/bulk-query'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

/** Safety ceiling on rows aggregated in one summary call. */
const SUMMARY_MAX_ROWS = 50_000
/** Page size used while streaming rows for aggregation. */
const AGG_PAGE_SIZE = 1_000

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

interface Pay2NewSummary {
  total: number
  success: number
  failed: number
  pending: number
  refunded: number
  total_amount: number
  total_charge: number
  truncated: boolean
}

async function summarizePay2New(
  supabase: SupabaseClient,
  partnerId: string,
  fromISO: string,
  toISO: string
): Promise<Pay2NewSummary> {
  const s: Pay2NewSummary = {
    total: 0, success: 0, failed: 0, pending: 0, refunded: 0,
    total_amount: 0, total_charge: 0, truncated: false,
  }

  let offset = 0
  while (offset < SUMMARY_MAX_ROWS) {
    const { data: rows, error } = await supabase
      .from('partner_wallet_ledger')
      .select('id, reference_id, description, status, created_at, debit, bill_fetch_ref')
      .eq('partner_id', partnerId)
      .eq('service_type', 'pay2new')
      .eq('transaction_type', 'DEBIT')
      .gte('created_at', fromISO)
      .lte('created_at', toISO)
      .order('created_at', { ascending: false })
      .range(offset, offset + AGG_PAGE_SIZE - 1)

    if (error) throw error
    const batch = (rows || []) as Pay2NewDebitRow[]
    if (batch.length === 0) break

    const resolved = await resolvePay2NewDebitStatesBatch(supabase, partnerId, batch)
    for (const r of resolved) {
      s.total += 1
      switch (r.status as Pay2NewStatus) {
        case 'SUCCESS': s.success += 1; break
        case 'FAILED': s.failed += 1; break
        case 'PENDING': s.pending += 1; break
        case 'REFUNDED': s.refunded += 1; break
      }
      // Count value only for money that stayed with the biller (SUCCESS).
      if (r.status === 'SUCCESS') {
        s.total_amount += r.amount || 0
        s.total_charge += r.charge || 0
      }
    }

    offset += batch.length
    if (batch.length < AGG_PAGE_SIZE) break
  }

  if (offset >= SUMMARY_MAX_ROWS) s.truncated = true
  s.total_amount = round2(s.total_amount)
  s.total_charge = round2(s.total_charge)
  return s
}

interface SettlementSummary {
  total: number
  success: number
  failed: number
  pending: number
  awaiting_approval: number
  rejected: number
  total_amount: number
  total_charges: number
  truncated: boolean
}

async function summarizeSettlement(
  supabase: SupabaseClient,
  partnerId: string,
  fromISO: string,
  toISO: string
): Promise<SettlementSummary> {
  const s: SettlementSummary = {
    total: 0, success: 0, failed: 0, pending: 0, awaiting_approval: 0, rejected: 0,
    total_amount: 0, total_charges: 0, truncated: false,
  }

  let offset = 0
  while (offset < SUMMARY_MAX_ROWS) {
    const { data: rows, error } = await supabase
      .from('shadval_settlement')
      .select('status, amount, charges')
      .eq('retailer_id', partnerId)
      .gte('created_at', fromISO)
      .lte('created_at', toISO)
      .order('created_at', { ascending: false })
      .range(offset, offset + AGG_PAGE_SIZE - 1)

    if (error) throw error
    const batch = rows || []
    if (batch.length === 0) break

    for (const t of batch) {
      s.total += 1
      const st = String(t.status || '').toUpperCase()
      switch (st) {
        case 'SUCCESS':
          s.success += 1
          s.total_amount += Number(t.amount) || 0
          s.total_charges += Number(t.charges) || 0
          break
        case 'FAILED': s.failed += 1; break
        case 'PENDING': s.pending += 1; break
        case 'AWAITING_APPROVAL': s.awaiting_approval += 1; break
        case 'REJECTED': s.rejected += 1; break
      }
    }

    offset += batch.length
    if (batch.length < AGG_PAGE_SIZE) break
  }

  if (offset >= SUMMARY_MAX_ROWS) s.truncated = true
  s.total_amount = round2(s.total_amount)
  s.total_charges = round2(s.total_charges)
  return s
}

/**
 * POST /api/partner/transactions/summary
 *
 * Aggregated counts + totals for a partner's Pay2New bill payments and
 * Settlement-2 account transfers over a date range. One call powers a
 * reconciliation dashboard (totals by status). Only services ENABLED for the
 * partner appear in the response.
 *
 * Body:
 *   { "from_date": "2026-10-01", "to_date": "2026-10-14" }
 *
 * Amount totals reflect only SUCCESS transactions (money that actually moved).
 * `truncated: true` means the range exceeded the aggregation cap — narrow it.
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

    const pay2newAllowed = partnerCanUseApi(partner, 'bbps2').allowed
    const settlementAllowed = partnerCanUseApi(partner, 'settlement').allowed
    if (!pay2newAllowed && !settlementAllowed) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Neither BBPS-2 (Pay2New) nor Settlement-2 is enabled for this partner account. Contact admin.' } },
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

    const supabase = getSupabase()

    const [pay2new, settlement] = await Promise.all([
      pay2newAllowed ? summarizePay2New(supabase, partner.id, params.fromISO, params.toISO) : Promise.resolve(null),
      settlementAllowed ? summarizeSettlement(supabase, partner.id, params.fromISO, params.toISO) : Promise.resolve(null),
    ])

    return NextResponse.json({
      success: true,
      from_date: params.fromISO,
      to_date: params.toISO,
      ...(pay2new ? { pay2new } : {}),
      ...(settlement ? { settlement } : {}),
    })
  } catch (error: any) {
    console.error('[Partner Transactions Summary] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
