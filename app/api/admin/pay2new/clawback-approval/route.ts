import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { pay2newCheckStatus } from '@/services/pay2new'
import * as Sentry from '@sentry/nextjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const ALLOWED_ROLES = ['admin', 'finance_executive']

// The CLAWBACK APPROVAL queue. The false-refund discovery cron (manual mode)
// DETECTS false refunds — a Pay2New CC payment we refunded that actually
// SUCCEEDED at the vendor — and tags the debit `FalseRefundConfirmed(...) Awaiting
// Approval`. It NEVER moves money. A human reviews each here and approves:
//   - balance covers the exact amount -> idempotent CLAWBACK_ re-debit now.
//   - balance short / frozen -> convert to RecoveryPending; the standing
//     pay2new-clawback-recovery cron re-debits the moment balance appears.
// Every approval re-verifies the vendor is STILL SUCCESS before any re-debit.

type ApproveResult =
  | 'recovered'          // clawback applied now
  | 'approved_pending'   // approved but balance short -> queued for recovery cron
  | 'would_recover'      // dry-run preview: vendor SUCCESS, clawback allowed
  | 'already_recovered'  // CLAWBACK_ already exists
  | 'not_refunded'       // no REFUND_ on our side -> nothing to claw back
  | 'refund_was_correct' // vendor no longer SUCCESS -> cleared from queue
  | 'wait'               // vendor pending / unreachable -> cannot confirm
  | 'too_large'          // above maxAmount guard
  | 'not_found'          // no debit in our ledgers
  | 'error'

type RowStatus = 'awaiting_approval' | 'approved_pending' | 'recovered'

interface ItemOut {
  request_id: string
  owner?: 'partner_api' | 'retailer'
  amount?: number
  result: ApproveResult
  provider_status?: string
  order_id?: string
  message?: string
}

const pickMeta = (d: string | null | undefined, key: string) => {
  const m = String(d || '').match(new RegExp(`${key}:\\s*([^|]+)`))
  return m ? m[1].trim() : null
}
const maskCard = (v: string | null | undefined) => {
  const digits = String(v || '').replace(/\D/g, '')
  return digits ? `****${digits.slice(-4)}` : null
}
const rowStatus = (desc: string | null | undefined, clawed: boolean): RowStatus => {
  const d = String(desc || '')
  if (clawed || /ReconVerified\(clawback\)/i.test(d)) return 'recovered'
  if (/RecoveryPending/i.test(d)) return 'approved_pending'
  return 'awaiting_approval'
}

/** GET — list detected false refunds (approval queue) + running exposure totals. */
export async function GET(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin) return NextResponse.json({ success: false, error: 'Session expired', code: 'SESSION_EXPIRED' }, { status: 401 })
    if (!ALLOWED_ROLES.includes(admin.role as string)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
    }

    const supabase = getSupabaseAdmin()
    const days = Math.min(365, Math.max(1, Number(request.nextUrl.searchParams.get('days') || 180)))
    const since = new Date(Date.now() - days * 864e5).toISOString()

    // ── DOMAIN 1 — partner-API flow (partner_wallet_ledger description tags) ──
    const { data: pRows, error: pErr } = await supabase
      .from('partner_wallet_ledger')
      .select('reference_id, partner_id, debit, description, created_at, refund_verified_status, refund_verified_at')
      .eq('service_type', 'pay2new')
      .eq('transaction_type', 'DEBIT')
      .ilike('reference_id', 'SDS%')
      .ilike('description', '%FalseRefundConfirmed%')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1000)
    if (pErr) return NextResponse.json({ success: false, error: pErr.message }, { status: 500 })
    const pList = (pRows || []) as Array<any>

    // Authoritative "already clawed back?" for Domain 1 — CLAWBACK_<ref> present.
    const clawedSet = new Set<string>()
    for (let i = 0; i < pList.length; i += 300) {
      const batch = pList.slice(i, i + 300).map((r) => `CLAWBACK_${r.reference_id}`)
      if (!batch.length) break
      const { data: cl } = await supabase
        .from('partner_wallet_ledger').select('reference_id').in('reference_id', batch)
      for (const row of cl || []) clawedSet.add(String((row as any).reference_id).replace(/^CLAWBACK_/, ''))
    }

    // ── DOMAIN 2 — in-app flow (pay2new_transactions; in-app partner + retailer) ──
    const { data: dRows, error: dErr } = await supabase
      .from('pay2new_transactions')
      .select('request_id, user_id, user_role, total_debit, amount, charge, product_name, customer_number, customer_name, card_number, card_last4, created_at, clawback_state, clawback_order_id, clawback_operator_ref, refund_verified_status, refund_verified_at')
      .not('clawback_state', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1000)
    if (dErr) return NextResponse.json({ success: false, error: dErr.message }, { status: 500 })
    const dList = (dRows || []) as Array<any>

    // ── Resolve display names (partners by id; retailers by partner_id=user_id) ──
    const partnerIds = Array.from(new Set([
      ...pList.map((r) => r.partner_id),
      ...dList.filter((r) => r.user_role === 'partner').map((r) => r.user_id),
    ].filter(Boolean)))
    const retailerIds = Array.from(new Set(dList.filter((r) => r.user_role !== 'partner').map((r) => r.user_id).filter(Boolean)))
    const nameMap = new Map<string, string>()
    if (partnerIds.length) {
      const { data } = await supabase.from('partners').select('id, name, business_name').in('id', partnerIds)
      for (const p of data || []) nameMap.set(String((p as any).id), (p as any).business_name || (p as any).name || '')
    }
    if (retailerIds.length) {
      const { data } = await supabase.from('retailers').select('partner_id, name').in('partner_id', retailerIds)
      for (const r of data || []) nameMap.set(String((r as any).partner_id), (r as any).name || '')
    }

    const items = [
      ...pList.map((r) => ({
        request_id: r.reference_id,
        owner: 'partner_api' as 'partner_api' | 'partner' | 'retailer',
        partner_id: r.partner_id,
        name: nameMap.get(String(r.partner_id)) || null,
        amount: Number(r.debit),
        created_at: r.created_at,
        status: rowStatus(r.description, clawedSet.has(r.reference_id)),
        vendor_status: r.refund_verified_status || 'SUCCESS',
        verified_at: r.refund_verified_at || null,
        order_id: pickMeta(r.description, 'order'),
        operator_reference: pickMeta(r.description, 'ref'),
        cc_card: maskCard(pickMeta(r.description, 'Card')),
        cc_name: pickMeta(r.description, 'Name'),
        cc_mobile: pickMeta(r.description, 'Mob'),
      })),
      ...dList.map((r) => ({
        request_id: r.request_id,
        owner: (r.user_role === 'partner' ? 'partner' : 'retailer') as 'partner_api' | 'partner' | 'retailer',
        partner_id: r.user_id,
        name: nameMap.get(String(r.user_id)) || null,
        amount: Number(r.total_debit) || (Number(r.amount || 0) + Number(r.charge || 0)),
        created_at: r.created_at,
        status: (r.clawback_state as RowStatus) || 'awaiting_approval',
        vendor_status: r.refund_verified_status || 'SUCCESS',
        verified_at: r.refund_verified_at || null,
        order_id: r.clawback_order_id || null,
        operator_reference: r.clawback_operator_ref || null,
        cc_card: r.card_last4 ? `****${String(r.card_last4).slice(-4)}` : maskCard(r.card_number),
        cc_name: r.customer_name || null,
        cc_mobile: r.customer_number || null,
      })),
    ]
    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    // Running exposure totals (the management "are we losing money?" numbers).
    const totals = {
      detected_count: items.length,
      detected_amount: items.reduce((s, i) => s + i.amount, 0),
      awaiting_count: 0, awaiting_amount: 0,
      pending_count: 0, pending_amount: 0,
      recovered_count: 0, recovered_amount: 0,
    }
    const byPartner = new Map<string, { partner_id: string; name: string | null; count: number; amount: number; recovered_amount: number }>()
    for (const it of items) {
      if (it.status === 'awaiting_approval') { totals.awaiting_count++; totals.awaiting_amount += it.amount }
      else if (it.status === 'approved_pending') { totals.pending_count++; totals.pending_amount += it.amount }
      else { totals.recovered_count++; totals.recovered_amount += it.amount }
      const key = String(it.partner_id)
      const agg = byPartner.get(key) || { partner_id: key, name: it.name, count: 0, amount: 0, recovered_amount: 0 }
      agg.count++; agg.amount += it.amount
      if (it.status === 'recovered') agg.recovered_amount += it.amount
      byPartner.set(key, agg)
    }

    return NextResponse.json({
      success: true,
      totals,
      by_partner: Array.from(byPartner.values()).sort((a, b) => b.amount - a.amount),
      count: items.length,
      items,
    })
  } catch (error: any) {
    console.error('[Admin Pay2New Clawback-Approval] GET error:', error)
    return NextResponse.json({ success: false, error: error?.message || 'Failed to list' }, { status: 500 })
  }
}

/**
 * POST — approve clawback(s). Body: { request_ids: string[], dryRun?: boolean }
 * dryRun defaults TRUE (safe preview). Each approval RE-VERIFIES vendor SUCCESS.
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
        const out = await approveOne(supabase, id, dryRun, maxAmount, String(admin.id))
        results.push(out)
        if (!dryRun && (out.result === 'recovered' || out.result === 'approved_pending')) {
          const line = `[Pay2New Clawback APPROVAL AUDIT] by=${admin.id} role=${admin.role} request_id=${out.request_id} amount=${out.amount} result=${out.result} vendor=${out.provider_status || 'n/a'}`
          console.log(line)
          try { Sentry.captureMessage(`Pay2New clawback ${out.result}: ${out.request_id} ₹${out.amount} by ${admin.id}`, 'info') } catch {}
        }
      } catch (e: any) {
        results.push({ request_id: id, result: 'error', message: e?.message })
      }
    }

    const summary = {
      recovered: results.filter((r) => r.result === 'recovered').length,
      approved_pending: results.filter((r) => r.result === 'approved_pending').length,
      would_recover: results.filter((r) => r.result === 'would_recover').length,
      already_recovered: results.filter((r) => r.result === 'already_recovered').length,
      refund_was_correct: results.filter((r) => r.result === 'refund_was_correct').length,
      waiting: results.filter((r) => r.result === 'wait').length,
      recovered_amount: results.filter((r) => r.result === 'recovered').reduce((s, r) => s + (r.amount || 0), 0),
      would_recover_amount: results.filter((r) => r.result === 'would_recover').reduce((s, r) => s + (r.amount || 0), 0),
    }
    return NextResponse.json({ success: true, dryRun, summary, results })
  } catch (error: any) {
    console.error('[Admin Pay2New Clawback-Approval] POST error:', error)
    return NextResponse.json({ success: false, error: error?.message || 'Approval failed' }, { status: 500 })
  }
}

async function approveOne(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  requestId: string,
  dryRun: boolean,
  maxAmount: number,
  adminId: string
): Promise<ItemOut> {
  // DOMAIN PROBE: an in-app txn (partner OR retailer) has a pay2new_transactions
  // row; the partner-API flow does not. This decides WHERE approval state is
  // tracked — pay2new_transactions.clawback_state (in-app) vs ledger description
  // tags (partner-API). Money movement is resolved from the ledgers either way.
  const { data: dtx } = await supabase
    .from('pay2new_transactions')
    .select('id').eq('request_id', requestId).maybeSingle()
  const isDirect = !!dtx

  // Resolve the original debit + owner from the ledgers (authoritative for money):
  // in-app partners AND partner-API both live in partner_wallet_ledger; retailers
  // live in wallet_ledger.
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

  // Track the APPROVED-but-unrecovered state on the right record so the standing
  // recovery cron can finish it (in-app -> clawback_state; partner-API -> tag).
  const trackPending = async (orderId: string | null, operatorRef: string | null) => {
    if (isDirect) {
      await supabase.from('pay2new_transactions')
        .update({ clawback_state: 'approved_pending', clawback_approved_by: adminId, clawback_order_id: orderId, clawback_operator_ref: operatorRef })
        .eq('request_id', requestId)
    } else {
      const base = desc || 'BBPS-2 CC'
      const next = /AwaitingApproval/i.test(base)
        ? base.replace(/AwaitingApproval/i, `RecoveryPending ApprovedBy(${adminId})`)
        : `${base} | FalseRefundConfirmed(order:${orderId || 'N/A'} ref:${operatorRef || 'N/A'}) RecoveryPending ApprovedBy(${adminId})`
      await supabase.from('partner_wallet_ledger').update({ description: next })
        .eq('partner_id', ownerId).eq('reference_id', requestId).eq('transaction_type', 'DEBIT')
    }
  }
  // Mark fully recovered on the right record.
  const trackRecovered = async (orderId: string | null, operatorRef: string | null) => {
    if (isDirect) {
      await supabase.from('pay2new_transactions')
        .update({ status: 'success', clawback_state: 'recovered', clawback_approved_by: adminId, clawback_order_id: orderId, clawback_operator_ref: operatorRef, order_id: orderId, operator_reference: operatorRef, review_required: false, completed_at: new Date().toISOString(), error_message: null })
        .eq('request_id', requestId)
    }
    if (owner === 'partner_api') {
      await supabase.from('partner_wallet_ledger')
        .update({ status: 'completed', description: `${desc || 'BBPS-2 CC'} | OrderID:${orderId || 'N/A'} | Ref:${operatorRef || 'N/A'} | ReconVerified(clawback) ApprovedBy(${adminId})` })
        .eq('partner_id', ownerId).eq('reference_id', requestId).not('description', 'ilike', '%OrderID:%')
    }
  }

  // Must have a REFUND_ to reverse; must not already be clawed back.
  const { data: refundRow } = await supabase.from(table).select('id').eq(idCol, ownerId).eq('reference_id', refundRef).maybeSingle()
  if (!refundRow) return { request_id: requestId, owner, amount, result: 'not_refunded' }
  const { data: clawRow } = await supabase.from(table).select('id').eq(idCol, ownerId).eq('reference_id', clawRef).maybeSingle()
  if (clawRow) {
    if (isDirect) await supabase.from('pay2new_transactions').update({ clawback_state: 'recovered' }).eq('request_id', requestId)
    return { request_id: requestId, owner, amount, result: 'already_recovered' }
  }

  // DUAL-CHECK: fresh vendor status — only a definitive SUCCESS justifies a clawback.
  const st = await pay2newCheckStatus({ request_id: requestId })
  const providerStatus = st.success ? st.status : 'UNREACHABLE'
  if (!st.success) return { request_id: requestId, owner, amount, result: 'wait', provider_status: providerStatus, message: 'Vendor unreachable — cannot confirm SUCCESS.' }
  if (st.status !== 'SUCCESS') {
    // Vendor flipped away from SUCCESS — the refund was actually correct. Clear it
    // from the approval queue so it stops showing.
    if (isDirect) {
      await supabase.from('pay2new_transactions')
        .update({ clawback_state: null, refund_verified_status: providerStatus, refund_verified_at: new Date().toISOString() })
        .eq('request_id', requestId)
    } else if (desc && /AwaitingApproval/i.test(desc)) {
      await supabase.from('partner_wallet_ledger')
        .update({ refund_verified_status: providerStatus, refund_verified_at: new Date().toISOString(), description: desc.replace(/\s*\|\s*FalseRefundConfirmed\([^)]*\)\s*AwaitingApproval/i, ' | RefundConfirmedCorrect') })
        .eq(idCol, ownerId).eq('reference_id', requestId).eq('transaction_type', 'DEBIT')
    }
    return { request_id: requestId, owner, amount, result: 'refund_was_correct', provider_status: providerStatus }
  }

  if (amount > maxAmount) return { request_id: requestId, owner, amount, result: 'too_large', provider_status: providerStatus, message: `Exceeds maxAmount ₹${maxAmount}` }
  if (dryRun) return { request_id: requestId, owner, amount, result: 'would_recover', provider_status: providerStatus, order_id: st.order_id }

  // ---- Execute idempotent clawback (reverse the wrong refund). Balance short /
  //      frozen -> APPROVE and hand off to the standing recovery cron. ----
  if (owner === 'partner_api') {
    const { data: wallet } = await supabase
      .from('partner_wallets').select('balance, is_frozen').eq('partner_id', ownerId).maybeSingle()
    const bal = Number(wallet?.balance || 0)
    if (wallet?.is_frozen || bal < amount) {
      await trackPending(st.order_id || null, st.operator_reference || null)
      return { request_id: requestId, owner, amount, result: 'approved_pending', provider_status: providerStatus, order_id: st.order_id, message: wallet?.is_frozen ? 'Wallet frozen — queued for recovery' : `Balance ₹${bal} < ₹${amount} — queued for recovery` }
    }
    const { error } = await supabase.rpc('debit_partner_wallet', {
      p_partner_id: ownerId, p_amount: amount, p_payout_transaction_id: null,
      p_description: `BBPS-2 clawback of false refund — vendor SUCCESS | orig ${requestId} | ApprovedBy(${adminId})`,
      p_reference_id: clawRef, p_service_type: 'pay2new',
    })
    if (error) {
      if (/insufficient/i.test(error.message || '')) {
        await trackPending(st.order_id || null, st.operator_reference || null)
        return { request_id: requestId, owner, amount, result: 'approved_pending', provider_status: providerStatus, order_id: st.order_id, message: 'Balance raced — queued for recovery' }
      }
      if (!/duplicate/i.test(error.message || '')) throw new Error(error.message)
    }
  } else {
    const { error } = await supabase.rpc('add_ledger_entry', {
      p_user_id: ownerId, p_user_role: 'retailer', p_wallet_type: 'primary', p_fund_category: 'service',
      p_service_type: 'pay2new', p_tx_type: 'PAY2NEW_DEBIT', p_credit: 0, p_debit: amount,
      p_reference_id: clawRef, p_status: 'completed', p_remarks: `BBPS-2 clawback of false refund — vendor SUCCESS | orig ${requestId} | ApprovedBy(${adminId})`,
    })
    if (error) {
      if (/insufficient/i.test(error.message || '')) {
        await trackPending(st.order_id || null, st.operator_reference || null)
        return { request_id: requestId, owner, amount, result: 'approved_pending', provider_status: providerStatus, order_id: st.order_id, message: 'Balance short — queued for recovery' }
      }
      if (!/duplicate/i.test(error.message || '')) throw new Error(error.message)
    }
  }

  await trackRecovered(st.order_id || null, st.operator_reference || null)
  return { request_id: requestId, owner, amount, result: 'recovered', provider_status: providerStatus, order_id: st.order_id, message: 'Clawback applied' }
}
