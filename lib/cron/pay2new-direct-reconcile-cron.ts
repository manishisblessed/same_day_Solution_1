/**
 * Pay2New (BBPS-2 Credit Card) DIRECT-USER reconciliation cron.
 *
 * Sibling of pay2new-reconcile-cron.ts, but for the IN-APP flow (retailers and
 * in-app partners) whose source of truth is the `pay2new_transactions` table and
 * whose money lives in `wallet_ledger` (retailer) / `partner_wallet_ledger`
 * (partner). The partner-API cron only scans partner_wallet_ledger, so without
 * this the in-app flow had NO backstop for a timed-out payment.
 *
 * WHY: the pay/recharge routes now leave an AMBIGUOUS (timed-out) payment as
 * 'pending' instead of false-refunding it. This cron finalizes those pendings:
 *   - provider SUCCESS                     -> mark success (never refund).
 *   - definitive FAILED / REFUNDED, or a
 *     "no transaction found" old enough to
 *     trust                                -> refund (idempotent) + mark refunded.
 *   - fresh not-found / provider pending /
 *     unreachable                          -> leave for the next cycle.
 *
 * POLICY (money movement — never false-refund a paid bill):
 *   - The ONLY age gate is a 15-min FLOOR (MIN_AGE_MIN); there is NO upper bound.
 *     A confirmed FAILED/REFUNDED pending is finalized no matter how old, and a
 *     true PENDING is held forever until the provider gives a terminal status.
 *   - DRY-RUN by default (PAY2NEW_DIRECT_RECON_DRY_RUN !== 'false').
 *   - NEVER refunds without a matching DEBIT ledger row (an orphaned 'pending'
 *     claim that never debited is marked failed, never credited).
 *   - "No transaction found" is inconclusive → flag for admin, never auto-refund.
 *   - Refund is idempotent (REFUND_<request_id>; wallet RPCs reject duplicates).
 *   - Batch cap, per-run refund cap, per-txn max-amount cap.
 */

import cron, { ScheduledTask } from 'node-cron'
import * as Sentry from '@sentry/nextjs'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { pay2newCheckStatus } from '@/services/pay2new'
import { reverseServiceCommission } from '@/lib/commission/distribute-service-commission'

const CRON_EXPRESSION = process.env.PAY2NEW_DIRECT_RECON_CRON || '*/5 * * * *'

function posInt(v: string | undefined, def: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : def
}

const CFG = {
  enabled: process.env.PAY2NEW_DIRECT_RECON_ENABLED !== 'false',
  dryRun: process.env.PAY2NEW_DIRECT_RECON_DRY_RUN !== 'false',
  // 15-min FLOOR only — no upper age bound (see policy note in the header).
  minAgeMin: posInt(process.env.PAY2NEW_DIRECT_RECON_MIN_AGE_MIN, 15),
  batch: posInt(process.env.PAY2NEW_DIRECT_RECON_BATCH, 25),
  maxAmount: posInt(process.env.PAY2NEW_DIRECT_RECON_MAX_AMOUNT, 100000),
  maxRefundsPerRun: posInt(process.env.PAY2NEW_DIRECT_RECON_MAX_REFUNDS_PER_RUN, 10),
  spacingMs: posInt(process.env.PAY2NEW_DIRECT_RECON_SPACING_MS, 350),
}

const g = globalThis as any
if (!g.__pay2newDirectReconState) {
  g.__pay2newDirectReconState = { task: null as ScheduledTask | null, isRunning: false }
}
const state = g.__pay2newDirectReconState

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface P2NTxn {
  id: string
  user_id: string
  user_role: string
  request_id: string
  product_code: string | null
  product_name: string | null
  amount: number | null
  charge: number | null
  total_debit: number | null
  status: string
  created_at: string
}

/** Mark the pay2new_transactions row's terminal state. */
async function markTxn(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  id: string,
  status: 'success' | 'failed' | 'refunded',
  extra: Record<string, any> = {}
): Promise<void> {
  await supabase
    .from('pay2new_transactions')
    .update({ status, completed_at: new Date().toISOString(), ...extra })
    .eq('id', id)
}

/**
 * Flag a held direct txn for ADMIN manual review (money stays held, status stays
 * 'pending', never auto-refunded). Used for an inconclusive "no transaction
 * found" and for a payment aged past the auto-act window.
 */
async function flagReview(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  txn: { id: string; request_id: string; user_id: string; total_debit?: number | null },
  reason: string
): Promise<void> {
  try {
    await supabase
      .from('pay2new_transactions')
      .update({ review_required: true, review_reason: reason })
      .eq('id', txn.id)
    Sentry.captureMessage(
      `Pay2New (direct) held payment needs admin review: ${txn.request_id} user=${txn.user_id} (${reason})`,
      'warning'
    )
    console.warn(`[Pay2New-DirectRecon] REVIEW flagged ref=${txn.request_id} (${reason}) — held, admin must resolve`)
  } catch (e: any) {
    console.error(`[Pay2New-DirectRecon] failed to flag review ${txn.request_id}:`, e?.message)
  }
}

/**
 * Refund a genuinely-not-paid direct txn. Returns 'refunded' | 'orphan' | 'exists'.
 * 'orphan' = no DEBIT ledger row (claimed but never debited) → nothing to refund.
 */
async function refundDirect(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  txn: P2NTxn
): Promise<'refunded' | 'orphan' | 'exists'> {
  const ref = txn.request_id
  const refundRef = `REFUND_${ref}`
  const total = Number(txn.total_debit) || (Number(txn.amount || 0) + Number(txn.charge || 0))
  if (!(total > 0)) return 'orphan'

  if (txn.user_role === 'partner') {
    const { data: debitRow } = await supabase
      .from('partner_wallet_ledger')
      .select('id')
      .eq('partner_id', txn.user_id)
      .eq('reference_id', ref)
      .gt('debit', 0)
      .limit(1)
      .maybeSingle()
    if (!debitRow) return 'orphan'

    const { data: existingRefund } = await supabase
      .from('partner_wallet_ledger')
      .select('id')
      .eq('partner_id', txn.user_id)
      .eq('reference_id', refundRef)
      .limit(1)
      .maybeSingle()
    if (existingRefund) return 'exists'

    const { error } = await supabase.rpc('credit_partner_wallet', {
      p_partner_id: txn.user_id,
      p_amount: total,
      p_transaction_type: 'REFUND',
      p_description: `Refund ₹${total} | ${txn.product_name || txn.product_code} — auto-refund (direct recon)`,
      p_reference_id: refundRef,
      p_service_type: 'pay2new',
    })
    if (error && !/duplicate/i.test(error.message || '')) throw new Error(error.message)
    return 'refunded'
  }

  // retailer → wallet_ledger
  const { data: debitRow } = await supabase
    .from('wallet_ledger')
    .select('id')
    .eq('retailer_id', txn.user_id)
    .eq('reference_id', ref)
    .gt('debit', 0)
    .limit(1)
    .maybeSingle()
  if (!debitRow) return 'orphan'

  const { data: existingRefund } = await supabase
    .from('wallet_ledger')
    .select('id')
    .eq('retailer_id', txn.user_id)
    .eq('reference_id', refundRef)
    .limit(1)
    .maybeSingle()
  if (existingRefund) return 'exists'

  const { error } = await supabase.rpc('add_ledger_entry', {
    p_user_id: txn.user_id,
    p_user_role: txn.user_role,
    p_wallet_type: 'primary',
    p_fund_category: 'service',
    p_service_type: 'pay2new',
    p_tx_type: 'PAY2NEW_REFUND',
    p_credit: total,
    p_debit: 0,
    p_reference_id: refundRef,
    p_status: 'completed',
    p_remarks: `Refund ₹${total} | ${txn.product_name || txn.product_code} — auto-refund (direct recon)`,
  })
  if (error && !/duplicate/i.test(error.message || '')) throw new Error(error.message)
  return 'refunded'
}

async function runCheck(): Promise<void> {
  if (state.isRunning) return
  state.isRunning = true
  const startedAt = Date.now()

  let checked = 0
  let refunded = 0
  let verified = 0

  try {
    const supabase = getSupabaseAdmin()
    const nowMs = Date.now()
    // Only the 15-min FLOOR applies — no upper age bound, so a confirmed failure
    // is finalized no matter how old and a PENDING one is held until resolved.
    const maxCreatedAt = new Date(nowMs - CFG.minAgeMin * 60_000).toISOString()

    const { data: candidates, error } = await supabase
      .from('pay2new_transactions')
      .select('id, user_id, user_role, request_id, product_code, product_name, amount, charge, total_debit, status, created_at')
      .eq('status', 'pending')
      .eq('review_required', false)
      .ilike('request_id', 'SDS%')
      .lt('created_at', maxCreatedAt)
      .order('created_at', { ascending: true })
      .limit(CFG.batch)

    if (error) {
      console.error('[Pay2New-DirectRecon] candidate query error:', error.message)
      return
    }
    if (!candidates || candidates.length === 0) return

    console.log(`[Pay2New-DirectRecon] ${candidates.length} candidate(s)${CFG.dryRun ? ' [DRY-RUN]' : ''}`)

    for (const c of candidates as P2NTxn[]) {
      const ref = c.request_id
      if (!ref) continue

      let res
      try {
        res = await pay2newCheckStatus({ request_id: ref })
      } catch (e: any) {
        console.error(`[Pay2New-DirectRecon] status error ${ref}:`, e?.message)
        continue
      } finally {
        await sleep(CFG.spacingMs)
      }
      checked++

      // Provider unreachable / unparseable → retry next cycle.
      if (!res.success) continue

      // Confirmed success → mark success, record order. Never refund.
      if (res.status === 'SUCCESS') {
        if (!CFG.dryRun) {
          await markTxn(supabase, c.id, 'success', {
            order_id: res.order_id || null,
            operator_reference: res.operator_reference || null,
            payment_channel: 'pay2new',
          })
        }
        verified++
        console.log(`[Pay2New-DirectRecon] SUCCESS confirmed ref=${ref}${CFG.dryRun ? ' [DRY-RUN]' : ''}`)
        continue
      }

      // "No transaction found" is INCONCLUSIVE (the provider's index can lag a
      // real charge) — per policy we NEVER auto-refund it. Flag for admin manual
      // review; the money stays held.
      if (res.notFound) {
        if (!CFG.dryRun) await flagReview(supabase, c, 'not_found')
        else console.log(`[Pay2New-DirectRecon] DRY-RUN would flag not_found ref=${ref}`)
        continue
      }

      // Auto-refund ONLY on a definitive order-level FAILED/REFUNDED verdict.
      const definitiveNotPaid =
        res.status === 'REFUNDED' || res.status === 'FAILED'
      if (!definitiveNotPaid) continue

      const amount = Number(c.total_debit) || (Number(c.amount || 0) + Number(c.charge || 0))
      if (!Number.isFinite(amount) || amount <= 0) {
        // Orphan claim (no debit captured) — release the pending lock.
        if (!CFG.dryRun) await markTxn(supabase, c.id, 'failed', { error_message: 'orphan pending (no debit)' })
        continue
      }

      if (amount > CFG.maxAmount) {
        console.error(`[Pay2New-DirectRecon] MANUAL REVIEW: ${ref} not paid but ₹${amount} exceeds cap ₹${CFG.maxAmount}`)
        Sentry.captureMessage(`Pay2New direct stuck debit over cap: ${ref} ₹${amount} user=${c.user_id}`, 'warning')
        continue
      }

      if (refunded >= CFG.maxRefundsPerRun) {
        console.warn(`[Pay2New-DirectRecon] per-run refund cap (${CFG.maxRefundsPerRun}) reached; deferring the rest`)
        break
      }

      const reason = res.status === 'REFUNDED' ? 'provider reversed/refunded' : (res.error || 'provider: not paid')

      if (CFG.dryRun) {
        console.log(`[Pay2New-DirectRecon] DRY-RUN would refund ₹${amount} ref=${ref} user=${c.user_id} (${reason})`)
        continue
      }

      try {
        const outcome = await refundDirect(supabase, c)
        if (outcome === 'refunded') {
          refunded++
          // Unwind any distributed commission/margin (idempotent no-op if none).
          await reverseServiceCommission({ supabase, service: 'pay2new', refPrefix: 'P2N', refKey: ref })
          await markTxn(supabase, c.id, 'refunded', { error_message: reason })
          console.log(`[Pay2New-DirectRecon] REFUNDED ₹${amount} ref=${ref} user=${c.user_id} (${reason})`)
        } else if (outcome === 'orphan') {
          await markTxn(supabase, c.id, 'failed', { error_message: 'orphan pending (no debit)' })
        } else {
          // refund already existed → just reconcile the txn status.
          await markTxn(supabase, c.id, 'refunded', { error_message: reason })
        }
      } catch (e: any) {
        console.error(`[Pay2New-DirectRecon] CRITICAL refund failed ${ref}:`, e?.message)
        Sentry.captureException(new Error(`Pay2New direct recon refund failed ${ref}: ${e?.message}`))
      }
    }

    // NOTE: No separate "aged / over-window" escalation. The 15-min floor is the
    // only age gate; the main loop above finalizes a confirmed FAILED/REFUNDED
    // pending no matter how old (refund), confirms SUCCESS, holds true PENDINGs,
    // and flags only the inconclusive "no transaction found" for admin review.
  } catch (e: any) {
    console.error('[Pay2New-DirectRecon] run error:', e?.message)
    Sentry.captureException(e)
  } finally {
    state.isRunning = false
    console.log(
      `[Pay2New-DirectRecon] done: checked=${checked} verified=${verified} refunded=${refunded}` +
        `${CFG.dryRun ? ' (DRY-RUN)' : ''} in ${Date.now() - startedAt}ms`
    )
  }
}

export async function initPay2NewDirectReconcileCron(): Promise<void> {
  if (!CFG.enabled) {
    console.log('[Pay2New-DirectRecon] disabled (PAY2NEW_DIRECT_RECON_ENABLED=false); not scheduling')
    return
  }
  if (state.task) {
    state.task.stop()
    state.task = null
  }
  state.task = cron.schedule(CRON_EXPRESSION, runCheck, { timezone: 'Asia/Kolkata' })
  console.log(
    `[Pay2New-DirectRecon] scheduled (${CRON_EXPRESSION}) dryRun=${CFG.dryRun} ` +
      `minAge=${CFG.minAgeMin}m (no max) batch=${CFG.batch} ` +
      `maxAmount=₹${CFG.maxAmount} maxRefunds/run=${CFG.maxRefundsPerRun}`
  )
}

export function stopPay2NewDirectReconcileCron(): void {
  if (state.task) {
    state.task.stop()
    state.task = null
  }
}
