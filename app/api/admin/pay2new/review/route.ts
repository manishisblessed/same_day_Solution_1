import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { pay2newCheckStatus } from '@/services/pay2new'
import { reverseServiceCommission } from '@/lib/commission/distribute-service-commission'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const ALLOWED_ROLES = ['admin', 'finance_executive']

// A manual refund is only permitted once a payment is at least this old, so an
// admin can never pre-empt a still-settling payment.
const MIN_MANUAL_REFUND_AGE_MS = 5 * 60_000

type RefundResult =
  | 'refunded'
  | 'already_refunded'
  | 'reconciled_success' // vendor SUCCESS → never refund
  | 'wait'               // still pending / provider unreachable
  | 'too_recent'         // < 5 min old
  | 'orphan'             // no debit captured
  | 'not_found'          // no such txn in our system
  | 'would_refund'       // dry-run: allowed
  | 'error'

interface ItemOut {
  request_id: string
  owner?: 'partner' | 'retailer' | 'partner_api'
  amount?: number
  result: RefundResult
  provider_status?: string
  message?: string
}

/** GET — list held / flagged-for-review Pay2New txns awaiting an admin decision. */
export async function GET(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin) return NextResponse.json({ success: false, error: 'Session expired', code: 'SESSION_EXPIRED' }, { status: 401 })
    if (!ALLOWED_ROLES.includes(admin.role as string)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
    }

    const supabase = getSupabaseAdmin()
    const days = Math.min(90, Math.max(1, Number(request.nextUrl.searchParams.get('days') || 30)))
    const since = new Date(Date.now() - days * 864e5).toISOString()

    // Direct flow: pay2new_transactions flagged review_required (money held).
    const { data: direct } = await supabase
      .from('pay2new_transactions')
      .select('request_id, user_id, user_role, amount, charge, total_debit, status, review_reason, created_at, product_name')
      .eq('review_required', true)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(500)

    // Partner-API flow: ledger DEBIT rows annotated ReviewRequired, no refund yet.
    const { data: partner } = await supabase
      .from('partner_wallet_ledger')
      .select('reference_id, partner_id, debit, description, created_at')
      .eq('service_type', 'pay2new')
      .eq('transaction_type', 'DEBIT')
      .ilike('description', '%ReviewRequired%')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(500)

    const items = [
      ...(direct || []).map((d: any) => ({
        request_id: d.request_id,
        owner: d.user_role === 'partner' ? 'partner' : 'retailer',
        amount: Number(d.total_debit) || Number(d.amount || 0) + Number(d.charge || 0),
        reason: d.review_reason,
        created_at: d.created_at,
        product_name: d.product_name,
      })),
      ...(partner || []).map((p: any) => ({
        request_id: p.reference_id,
        owner: 'partner_api',
        amount: Number(p.debit),
        reason: (String(p.description || '').match(/ReviewRequired\(([^)]+)\)/) || [])[1] || 'review',
        created_at: p.created_at,
        product_name: 'BBPS-2 CC',
      })),
    ]

    return NextResponse.json({ success: true, count: items.length, items })
  } catch (error: any) {
    console.error('[Admin Pay2New Review] GET error:', error)
    return NextResponse.json({ success: false, error: error?.message || 'Failed to list' }, { status: 500 })
  }
}

/**
 * POST — manually refund held Pay2New txns.
 * Body: { request_ids: string[], dryRun?: boolean }
 *
 * SAFETY (every refund passes ALL of these):
 *   1. txn ≥ 5 minutes old.
 *   2. FRESH Pay2New status re-check at refund time — refund ONLY when the vendor
 *      definitively did NOT charge (FAILED / no-transaction-found / reversed).
 *      SUCCESS → blocked. PENDING / unreachable → blocked (wait).
 *   3. Idempotent (REFUND_<id>; wallet RPCs reject duplicates).
 *   4. Reverses any distributed commission so margin nets to 0.
 */
export async function POST(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin) return NextResponse.json({ success: false, error: 'Session expired', code: 'SESSION_EXPIRED' }, { status: 401 })
    if (!ALLOWED_ROLES.includes(admin.role as string)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const requestIds: string[] = Array.isArray(body?.request_ids)
      ? body.request_ids.map((s: any) => String(s).trim()).filter(Boolean)
      : []
    const dryRun = body?.dryRun !== false // default to a safe preview
    if (requestIds.length === 0) {
      return NextResponse.json({ success: false, error: 'request_ids is required' }, { status: 400 })
    }
    if (requestIds.length > 100) {
      return NextResponse.json({ success: false, error: 'Max 100 ids per call' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const results: ItemOut[] = []

    for (const requestId of requestIds) {
      try {
        results.push(await processOne(supabase, requestId, dryRun))
      } catch (e: any) {
        results.push({ request_id: requestId, result: 'error', message: e?.message })
      }
    }

    const summary = {
      refunded: results.filter((r) => r.result === 'refunded').length,
      would_refund: results.filter((r) => r.result === 'would_refund').length,
      already_refunded: results.filter((r) => r.result === 'already_refunded').length,
      blocked_success: results.filter((r) => r.result === 'reconciled_success').length,
      waiting: results.filter((r) => r.result === 'wait' || r.result === 'too_recent').length,
      total_refunded_amount: results
        .filter((r) => r.result === 'refunded')
        .reduce((s, r) => s + (r.amount || 0), 0),
    }

    return NextResponse.json({ success: true, dryRun, summary, results })
  } catch (error: any) {
    console.error('[Admin Pay2New Review] POST error:', error)
    return NextResponse.json({ success: false, error: error?.message || 'Refund failed' }, { status: 500 })
  }
}

async function processOne(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  requestId: string,
  dryRun: boolean
): Promise<ItemOut> {
  // Resolve the txn + owner. Direct flow lives in pay2new_transactions; partner-
  // API flow lives only in partner_wallet_ledger.
  const { data: dtx } = await supabase
    .from('pay2new_transactions')
    .select('id, user_id, user_role, amount, charge, total_debit, status, created_at')
    .eq('request_id', requestId)
    .maybeSingle()

  let owner: 'partner' | 'retailer' | 'partner_api'
  let ownerId: string
  let amount: number
  let createdAt: string
  let directId: string | null = null
  let ledgerDesc: string | null = null

  if (dtx) {
    owner = (dtx as any).user_role === 'partner' ? 'partner' : 'retailer'
    ownerId = (dtx as any).user_id
    amount = Number((dtx as any).total_debit) || Number((dtx as any).amount || 0) + Number((dtx as any).charge || 0)
    createdAt = (dtx as any).created_at
    directId = (dtx as any).id
  } else {
    const { data: debit } = await supabase
      .from('partner_wallet_ledger')
      .select('partner_id, debit, description, created_at')
      .eq('reference_id', requestId)
      .eq('transaction_type', 'DEBIT')
      .gt('debit', 0)
      .maybeSingle()
    if (!debit) return { request_id: requestId, result: 'not_found' }
    owner = 'partner_api'
    ownerId = (debit as any).partner_id
    amount = Number((debit as any).debit)
    createdAt = (debit as any).created_at
    ledgerDesc = (debit as any).description
  }

  if (!(amount > 0)) return { request_id: requestId, owner, result: 'orphan' }

  // Gate 1 — age.
  if (Date.now() - new Date(createdAt).getTime() < MIN_MANUAL_REFUND_AGE_MS) {
    return { request_id: requestId, owner, amount, result: 'too_recent', message: 'Wait at least 5 minutes after the transaction.' }
  }

  // Gate 2 — fresh vendor status; refund ONLY on a definitive not-charged.
  const st = await pay2newCheckStatus({ request_id: requestId })
  const providerStatus = st.success ? st.status : 'UNREACHABLE'
  if (!st.success) {
    return { request_id: requestId, owner, amount, result: 'wait', provider_status: providerStatus, message: 'Provider unreachable — cannot confirm not-charged.' }
  }
  if (st.status === 'SUCCESS') {
    return { request_id: requestId, owner, amount, result: 'reconciled_success', provider_status: providerStatus, message: 'Vendor shows SUCCESS — refund blocked.' }
  }
  if (st.status !== 'FAILED' && st.status !== 'REFUNDED') {
    return { request_id: requestId, owner, amount, result: 'wait', provider_status: providerStatus, message: 'Still pending at vendor — hold.' }
  }

  if (dryRun) {
    return { request_id: requestId, owner, amount, result: 'would_refund', provider_status: providerStatus }
  }

  // ---- Execute refund (idempotent) ----
  const refundRef = `REFUND_${requestId}`
  const reason = st.status === 'REFUNDED' ? 'provider reversed/refunded' : (st.notFound ? 'provider: no transaction found' : 'provider: failed')

  if (owner === 'retailer') {
    const { data: debitRow } = await supabase
      .from('wallet_ledger').select('id').eq('retailer_id', ownerId).eq('reference_id', requestId).gt('debit', 0).limit(1).maybeSingle()
    if (!debitRow) return { request_id: requestId, owner, amount, result: 'orphan', message: 'No debit captured.' }
    const { data: existing } = await supabase
      .from('wallet_ledger').select('id').eq('retailer_id', ownerId).eq('reference_id', refundRef).limit(1).maybeSingle()
    if (existing) { if (directId) await markRefunded(supabase, directId, reason); return { request_id: requestId, owner, amount, result: 'already_refunded' } }
    const { error } = await supabase.rpc('add_ledger_entry', {
      p_user_id: ownerId, p_user_role: 'retailer', p_wallet_type: 'primary', p_fund_category: 'service',
      p_service_type: 'pay2new', p_tx_type: 'PAY2NEW_REFUND', p_credit: amount, p_debit: 0,
      p_reference_id: refundRef, p_status: 'completed', p_remarks: `Refund ₹${amount} — admin manual (${reason})`,
    })
    if (error && !/duplicate/i.test(error.message || '')) throw new Error(error.message)
  } else {
    // partner (direct in-app) and partner_api both refund the partner wallet.
    const { data: debitRow } = await supabase
      .from('partner_wallet_ledger').select('id').eq('partner_id', ownerId).eq('reference_id', requestId).gt('debit', 0).limit(1).maybeSingle()
    if (!debitRow) return { request_id: requestId, owner, amount, result: 'orphan', message: 'No debit captured.' }
    const { data: existing } = await supabase
      .from('partner_wallet_ledger').select('id').eq('partner_id', ownerId).eq('reference_id', refundRef).limit(1).maybeSingle()
    if (existing) { if (directId) await markRefunded(supabase, directId, reason); return { request_id: requestId, owner, amount, result: 'already_refunded' } }
    const { error } = await supabase.rpc('refund_partner_wallet', {
      p_partner_id: ownerId, p_amount: amount, p_payout_transaction_id: null,
      p_description: `${ledgerDesc || 'BBPS-2 CC'} — admin manual refund (${reason})`,
      p_reference_id: refundRef, p_service_type: 'pay2new',
    })
    if (error && !/duplicate/i.test(error.message || '')) throw new Error(error.message)
  }

  // Unwind commission/margin → net 0 (idempotent).
  await reverseServiceCommission({ supabase, service: 'pay2new', refPrefix: 'P2N', refKey: requestId })

  // Clear the held flag / annotate.
  if (directId) await markRefunded(supabase, directId, reason)
  else if (owner === 'partner_api' && ledgerDesc && !/ReviewResolved/.test(ledgerDesc)) {
    await supabase.from('partner_wallet_ledger')
      .update({ description: `${ledgerDesc} | ReviewResolved(refunded)` })
      .eq('reference_id', requestId).eq('transaction_type', 'DEBIT')
  }

  return { request_id: requestId, owner, amount, result: 'refunded', provider_status: providerStatus, message: reason }
}

async function markRefunded(supabase: ReturnType<typeof getSupabaseAdmin>, id: string, reason: string) {
  await supabase
    .from('pay2new_transactions')
    .update({ status: 'refunded', review_required: false, error_message: reason, completed_at: new Date().toISOString() })
    .eq('id', id)
}
