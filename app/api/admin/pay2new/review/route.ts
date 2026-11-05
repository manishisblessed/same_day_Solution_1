import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { checkStatusWithLog } from '@/lib/pay2new/status-log'
import { reverseServiceCommission } from '@/lib/commission/distribute-service-commission'
import * as Sentry from '@sentry/nextjs'

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
      .select('request_id, user_id, user_role, amount, charge, total_debit, status, review_reason, created_at, product_name, customer_number, customer_name, card_number, card_last4')
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

    // Extract embedded "Key:value" tokens from a ledger description, and mask a
    // card number to last-4 only (full PAN is never surfaced in the UI).
    const pickMeta = (d: string | null | undefined, key: string) => {
      const m = String(d || '').match(new RegExp(`${key}:\\s*([^|]+)`))
      return m ? m[1].trim() : null
    }
    const maskCard = (v: string | null | undefined) => {
      const digits = String(v || '').replace(/\D/g, '')
      return digits ? `****${digits.slice(-4)}` : null
    }

    const items: any[] = [
      ...(direct || []).map((d: any) => ({
        request_id: d.request_id,
        owner: d.user_role === 'partner' ? 'partner' : 'retailer',
        amount: Number(d.total_debit) || Number(d.amount || 0) + Number(d.charge || 0),
        reason: d.review_reason,
        created_at: d.created_at,
        product_name: d.product_name,
        name: null as string | null,
        cc_card: d.card_last4 ? `****${String(d.card_last4).slice(-4)}` : maskCard(d.card_number),
        cc_mobile: d.customer_number || null,
        cc_name: d.customer_name || null,
        _partnerId: d.user_role === 'partner' ? d.user_id : null,
        _retailerId: d.user_role === 'partner' ? null : d.user_id,
      })),
      ...(partner || []).map((p: any) => ({
        request_id: p.reference_id,
        owner: 'partner_api',
        amount: Number(p.debit),
        reason: (String(p.description || '').match(/ReviewRequired\(([^)]+)\)/) || [])[1] || 'review',
        created_at: p.created_at,
        product_name: 'BBPS-2 CC',
        name: null as string | null,
        cc_card: maskCard(pickMeta(p.description, 'Card')),
        cc_mobile: pickMeta(p.description, 'Mob'),
        cc_name: pickMeta(p.description, 'Name'),
        _partnerId: p.partner_id,
        _retailerId: null,
      })),
    ]

    // ── COMPLETENESS SAFETY NET ──────────────────────────────────────────────
    // Also surface partner-API pay2new debits that are STUCK (debited, aged past
    // the 30-min auto floor, no recorded order, not failed) but have not yet been
    // tagged ReviewRequired — so held money can never stay invisible if a recon
    // cycle has not reached/tagged it. Rows already refunded (REFUND_) or already
    // listed above are excluded/deduped.
    try {
      const floorIso = new Date(Date.now() - 30 * 60_000).toISOString()
      const { data: stuck } = await supabase
        .from('partner_wallet_ledger')
        .select('reference_id, partner_id, debit, description, created_at')
        .eq('service_type', 'pay2new')
        .eq('transaction_type', 'DEBIT')
        .ilike('reference_id', 'SDS%')
        .neq('status', 'failed')
        .gt('debit', 0)
        .gte('created_at', since)
        .lt('created_at', floorIso)
        .not('description', 'ilike', '%OrderID:%')
        .not('description', 'ilike', '%ReconVerified%')
        .not('description', 'ilike', '%ReviewRequired%')
        .order('created_at', { ascending: false })
        .limit(500)

      const stuckRows = (stuck || []) as Array<{ reference_id: string; partner_id: string; debit: number; description: string | null; created_at: string }>
      const refundedSet = new Set<string>()
      for (let i = 0; i < stuckRows.length; i += 300) {
        const batch = stuckRows.slice(i, i + 300).map((r) => `REFUND_${r.reference_id}`)
        if (batch.length === 0) break
        const { data: refs } = await supabase
          .from('partner_wallet_ledger')
          .select('reference_id')
          .in('reference_id', batch)
        for (const r of refs || []) refundedSet.add(String((r as any).reference_id).replace(/^REFUND_/, ''))
      }

      const seen = new Set(items.map((i) => i.request_id))
      for (const r of stuckRows) {
        if (refundedSet.has(r.reference_id) || seen.has(r.reference_id)) continue
        items.push({
          request_id: r.reference_id,
          owner: 'partner_api',
          amount: Number(r.debit),
          reason: /FailedConfirmed/i.test(r.description || '') ? 'failed — auto-refund confirming' : 'unverified',
          created_at: r.created_at,
          product_name: 'BBPS-2 CC',
          name: null as string | null,
          cc_card: maskCard(pickMeta(r.description, 'Card')),
          cc_mobile: pickMeta(r.description, 'Mob'),
          cc_name: pickMeta(r.description, 'Name'),
          _partnerId: r.partner_id,
          _retailerId: null,
        })
      }
    } catch (e: any) {
      console.error('[Admin Pay2New Review] stuck-discovery error:', e?.message)
    }

    // ── RESOLVE OWNER NAMES ───────────────────────────────────────────────────
    // Partners live in `partners` (keyed by id); retailers in `retailers` (keyed
    // by partner_id). Batch-resolve both, then attach a display name per item.
    try {
      const partnerIds = Array.from(new Set(items.map((i) => i._partnerId).filter(Boolean)))
      const retailerIds = Array.from(new Set(items.map((i) => i._retailerId).filter(Boolean)))
      const nameMap = new Map<string, string>()
      if (partnerIds.length) {
        const { data } = await supabase.from('partners').select('id, name, business_name').in('id', partnerIds)
        for (const p of data || []) nameMap.set(String((p as any).id), (p as any).business_name || (p as any).name || '')
      }
      if (retailerIds.length) {
        const { data } = await supabase.from('retailers').select('partner_id, name').in('partner_id', retailerIds)
        for (const r of data || []) nameMap.set(String((r as any).partner_id), (r as any).name || '')
      }
      for (const it of items) {
        it.name = (it._partnerId && nameMap.get(it._partnerId)) || (it._retailerId && nameMap.get(it._retailerId)) || null
        delete it._partnerId
        delete it._retailerId
      }
    } catch (e: any) {
      console.error('[Admin Pay2New Review] name-resolve error:', e?.message)
      for (const it of items) { delete it._partnerId; delete it._retailerId }
    }

    // ── CURRENT STATUS (already refunded?) ────────────────────────────────────
    // A row can remain listed (the ReviewRequired tag persists on the ledger)
    // even after its money was already returned. Surface the authoritative
    // current status — REFUND_<id> present = refunded — so the sub-admin sees it
    // at a glance and the Refund button can be disabled (refund is idempotent, so
    // a re-click is harmless, just confusing).
    try {
      const allRefs = Array.from(new Set(items.map((i) => i.request_id).filter(Boolean)))
      const refundedSet = new Set<string>()
      for (let i = 0; i < allRefs.length; i += 300) {
        const batch = allRefs.slice(i, i + 300).map((r) => `REFUND_${r}`)
        if (!batch.length) break
        const [p, r] = await Promise.all([
          supabase.from('partner_wallet_ledger').select('reference_id').in('reference_id', batch),
          supabase.from('wallet_ledger').select('reference_id').in('reference_id', batch),
        ])
        for (const row of p.data || []) refundedSet.add(String((row as any).reference_id).replace(/^REFUND_/, ''))
        for (const row of r.data || []) refundedSet.add(String((row as any).reference_id).replace(/^REFUND_/, ''))
      }
      for (const it of items) it.current_status = refundedSet.has(it.request_id) ? 'refunded' : 'held'
    } catch (e: any) {
      console.error('[Admin Pay2New Review] current-status error:', e?.message)
      for (const it of items) if (!it.current_status) it.current_status = 'held'
    }

    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

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
        const out = await processOne(supabase, requestId, dryRun)
        results.push(out)
        // AUDIT TRAIL: record who refunded what, the vendor verdict at click time,
        // and the amount. This is the accountability record for the delegated
        // sub-admin workflow (admin / finance_executive).
        if (!dryRun && out.result === 'refunded') {
          const line = `[Pay2New Manual Refund AUDIT] by=${admin.id} role=${admin.role} request_id=${out.request_id} owner=${out.owner} amount=${out.amount} vendor=${out.provider_status || 'n/a'} reason=${out.message || ''}`
          console.log(line)
          try {
            Sentry.captureMessage(
              `Pay2New manual refund: ${out.request_id} ₹${out.amount} by ${admin.id} (vendor=${out.provider_status || 'n/a'})`,
              'info'
            )
          } catch {}
        }
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
  // Probe + persist raw payload as evidence (this is the verdict the refund rests on).
  const st = await checkStatusWithLog(supabase, { request_id: requestId }, 'admin')
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
