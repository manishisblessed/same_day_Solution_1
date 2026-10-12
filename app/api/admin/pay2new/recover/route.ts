import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { pay2newCheckStatus } from '@/services/pay2new'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const ALLOWED_ROLES = ['admin', 'finance_executive']

// Server-side equivalent of scripts/pay2new-false-refund-sweep.cjs, but callable
// from the DEPLOYED (IP-whitelisted) app so the live vendor status check works.
//
// Recovers a FALSE REFUND: a Pay2New CC payment we REFUNDED on our side that
// actually SUCCEEDED at the vendor. Reverses the wrong refund with an idempotent
// CLAWBACK_<id> re-debit. Acts ONLY when the vendor FRESHLY confirms SUCCESS.

type RecoverResult =
  | 'recovered'
  | 'would_recover'        // dry-run: vendor SUCCESS, clawback allowed
  | 'already_recovered'    // CLAWBACK_ already exists
  | 'not_refunded'         // no REFUND_ on our side → nothing to claw back
  | 'refund_was_correct'   // vendor NOT success → the refund was right, leave it
  | 'wait'                 // vendor pending / unreachable → cannot confirm
  | 'too_large'            // above maxAmount guard
  | 'insufficient_balance' // partner spent the money; cannot re-debit
  | 'not_found'            // no debit in our ledgers
  | 'error'

interface ItemOut {
  request_id: string
  owner?: 'partner_api' | 'retailer'
  amount?: number
  result: RecoverResult
  provider_status?: string
  order_id?: string
  message?: string
}

/** GET — auto-discover false-refund candidates (REFUND_ present, no CLAWBACK_). */
export async function GET(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin) return NextResponse.json({ success: false, error: 'Session expired', code: 'SESSION_EXPIRED' }, { status: 401 })
    if (!ALLOWED_ROLES.includes(admin.role as string)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
    }
    const supabase = getSupabaseAdmin()
    const days = Math.min(120, Math.max(1, Number(request.nextUrl.searchParams.get('days') || 60)))
    const since = new Date(Date.now() - days * 864e5).toISOString()

    const { data: pRows } = await supabase
      .from('partner_wallet_ledger')
      .select('partner_id, reference_id, debit, description, created_at')
      .eq('service_type', 'pay2new')
      .eq('transaction_type', 'DEBIT')
      .gt('debit', 0)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1000)

    const { data: rRows } = await supabase
      .from('wallet_ledger')
      .select('retailer_id, reference_id, debit, created_at')
      .eq('service_type', 'pay2new')
      .gt('debit', 0)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1000)

    const candidates: any[] = []
    for (const d of pRows || []) {
      const ref = (d as any).reference_id as string
      if (!ref || ref.startsWith('REFUND_') || ref.startsWith('CLAWBACK_')) continue
      const { count: refunded } = await supabase
        .from('partner_wallet_ledger').select('id', { count: 'exact', head: true })
        .eq('partner_id', (d as any).partner_id).eq('reference_id', `REFUND_${ref}`)
      if (!refunded) continue
      const { count: clawed } = await supabase
        .from('partner_wallet_ledger').select('id', { count: 'exact', head: true })
        .eq('partner_id', (d as any).partner_id).eq('reference_id', `CLAWBACK_${ref}`)
      if (clawed) continue
      candidates.push({ request_id: ref, owner: 'partner_api', amount: Number((d as any).debit), created_at: (d as any).created_at })
    }
    for (const d of rRows || []) {
      const ref = (d as any).reference_id as string
      if (!ref || ref.startsWith('REFUND_') || ref.startsWith('CLAWBACK_')) continue
      const { count: refunded } = await supabase
        .from('wallet_ledger').select('id', { count: 'exact', head: true })
        .eq('retailer_id', (d as any).retailer_id).eq('reference_id', `REFUND_${ref}`)
      if (!refunded) continue
      const { count: clawed } = await supabase
        .from('wallet_ledger').select('id', { count: 'exact', head: true })
        .eq('retailer_id', (d as any).retailer_id).eq('reference_id', `CLAWBACK_${ref}`)
      if (clawed) continue
      candidates.push({ request_id: ref, owner: 'retailer', amount: Number((d as any).debit), created_at: (d as any).created_at })
    }

    return NextResponse.json({ success: true, count: candidates.length, candidates })
  } catch (error: any) {
    console.error('[Admin Pay2New Recover] GET error:', error)
    return NextResponse.json({ success: false, error: error?.message || 'Failed to discover' }, { status: 500 })
  }
}

/**
 * POST — recover (clawback) false refunds for explicit request_ids.
 * Body: { request_ids: string[], dryRun?: boolean, maxAmount?: number }
 * dryRun defaults TRUE (safe preview). Vendor must FRESHLY confirm SUCCESS.
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
    const dryRun = body?.dryRun !== false
    const maxAmount = Number(body?.maxAmount) > 0 ? Number(body.maxAmount) : 100000
    if (requestIds.length === 0) return NextResponse.json({ success: false, error: 'request_ids is required' }, { status: 400 })
    if (requestIds.length > 100) return NextResponse.json({ success: false, error: 'Max 100 ids per call' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const results: ItemOut[] = []
    for (const id of Array.from(new Set(requestIds))) {
      try {
        results.push(await recoverOne(supabase, id, dryRun, maxAmount))
      } catch (e: any) {
        results.push({ request_id: id, result: 'error', message: e?.message })
      }
    }

    const summary = {
      recovered: results.filter((r) => r.result === 'recovered').length,
      would_recover: results.filter((r) => r.result === 'would_recover').length,
      already_recovered: results.filter((r) => r.result === 'already_recovered').length,
      refund_was_correct: results.filter((r) => r.result === 'refund_was_correct').length,
      waiting: results.filter((r) => r.result === 'wait').length,
      insufficient_balance: results.filter((r) => r.result === 'insufficient_balance').length,
      recovered_amount: results.filter((r) => r.result === 'recovered').reduce((s, r) => s + (r.amount || 0), 0),
      would_recover_amount: results.filter((r) => r.result === 'would_recover').reduce((s, r) => s + (r.amount || 0), 0),
    }
    return NextResponse.json({ success: true, dryRun, summary, results })
  } catch (error: any) {
    console.error('[Admin Pay2New Recover] POST error:', error)
    return NextResponse.json({ success: false, error: error?.message || 'Recovery failed' }, { status: 500 })
  }
}

async function recoverOne(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  requestId: string,
  dryRun: boolean,
  maxAmount: number
): Promise<ItemOut> {
  // Resolve the original debit + owner.
  const { data: pDebit } = await supabase
    .from('partner_wallet_ledger')
    .select('partner_id, debit, description')
    .eq('service_type', 'pay2new').eq('transaction_type', 'DEBIT').eq('reference_id', requestId).gt('debit', 0)
    .maybeSingle()

  let owner: 'partner_api' | 'retailer'
  let ownerId: string
  let amount: number
  let desc: string | null = null

  if (pDebit) {
    owner = 'partner_api'; ownerId = (pDebit as any).partner_id; amount = Number((pDebit as any).debit); desc = (pDebit as any).description
  } else {
    const { data: rDebit } = await supabase
      .from('wallet_ledger').select('retailer_id, debit').eq('service_type', 'pay2new').eq('reference_id', requestId).gt('debit', 0)
      .maybeSingle()
    if (!rDebit) return { request_id: requestId, result: 'not_found' }
    owner = 'retailer'; ownerId = (rDebit as any).retailer_id; amount = Number((rDebit as any).debit)
  }

  const refundRef = `REFUND_${requestId}`
  const clawRef = `CLAWBACK_${requestId}`
  const table = owner === 'partner_api' ? 'partner_wallet_ledger' : 'wallet_ledger'
  const idCol = owner === 'partner_api' ? 'partner_id' : 'retailer_id'

  // Must have a REFUND_ to reverse; must not already be clawed back.
  const { data: refundRow } = await supabase.from(table).select('id').eq(idCol, ownerId).eq('reference_id', refundRef).maybeSingle()
  if (!refundRow) return { request_id: requestId, owner, amount, result: 'not_refunded' }
  const { data: clawRow } = await supabase.from(table).select('id').eq(idCol, ownerId).eq('reference_id', clawRef).maybeSingle()
  if (clawRow) return { request_id: requestId, owner, amount, result: 'already_recovered' }

  // FRESH vendor status — only a definitive SUCCESS justifies a clawback.
  const st = await pay2newCheckStatus({ request_id: requestId })
  const providerStatus = st.success ? st.status : 'UNREACHABLE'
  if (!st.success) return { request_id: requestId, owner, amount, result: 'wait', provider_status: providerStatus, message: 'Vendor unreachable — cannot confirm SUCCESS.' }
  if (st.status !== 'SUCCESS') return { request_id: requestId, owner, amount, result: 'refund_was_correct', provider_status: providerStatus }

  if (amount > maxAmount) return { request_id: requestId, owner, amount, result: 'too_large', provider_status: providerStatus, message: `Exceeds maxAmount ₹${maxAmount}` }
  if (dryRun) return { request_id: requestId, owner, amount, result: 'would_recover', provider_status: providerStatus, order_id: st.order_id }

  // ---- Execute idempotent clawback (reverse the wrong refund) ----
  try {
    if (owner === 'partner_api') {
      const { error } = await supabase.rpc('debit_partner_wallet', {
        p_partner_id: ownerId, p_amount: amount, p_payout_transaction_id: null,
        p_description: `BBPS-2 clawback of false refund — vendor SUCCESS | orig ${requestId}`,
        p_reference_id: clawRef, p_service_type: 'pay2new',
      })
      if (error) {
        if (/insufficient/i.test(error.message || '')) return { request_id: requestId, owner, amount, result: 'insufficient_balance', provider_status: providerStatus, message: error.message }
        if (!/duplicate/i.test(error.message || '')) throw new Error(error.message)
      }
      await supabase.from('partner_wallet_ledger')
        .update({ status: 'completed', description: `${desc || 'BBPS-2 CC'} | OrderID:${st.order_id || 'N/A'} | Ref:${st.operator_reference || 'N/A'} | ReconVerified(clawback)` })
        .eq('partner_id', ownerId).eq('reference_id', requestId).not('description', 'ilike', '%OrderID:%')
    } else {
      const { error } = await supabase.rpc('add_ledger_entry', {
        p_user_id: ownerId, p_user_role: 'retailer', p_wallet_type: 'primary', p_fund_category: 'service',
        p_service_type: 'pay2new', p_tx_type: 'PAY2NEW_DEBIT', p_credit: 0, p_debit: amount,
        p_reference_id: clawRef, p_status: 'completed', p_remarks: `BBPS-2 clawback of false refund — vendor SUCCESS | orig ${requestId}`,
      })
      if (error) {
        if (/insufficient/i.test(error.message || '')) return { request_id: requestId, owner, amount, result: 'insufficient_balance', provider_status: providerStatus, message: error.message }
        if (!/duplicate/i.test(error.message || '')) throw new Error(error.message)
      }
    }
    // Flip any in-app txn row to success (partner-API flow has none; harmless no-op).
    await supabase.from('pay2new_transactions')
      .update({ status: 'success', order_id: st.order_id || null, operator_reference: st.operator_reference || null, review_required: false, completed_at: new Date().toISOString(), error_message: null })
      .eq('request_id', requestId).neq('status', 'success')

    return { request_id: requestId, owner, amount, result: 'recovered', provider_status: providerStatus, order_id: st.order_id, message: 'Clawback applied' }
  } catch (e: any) {
    return { request_id: requestId, owner, amount, result: 'error', provider_status: providerStatus, message: e?.message }
  }
}
