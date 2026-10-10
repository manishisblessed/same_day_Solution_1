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
 * SAFETY (money movement — conservative defaults):
 *   - DRY-RUN by default (PAY2NEW_DIRECT_RECON_DRY_RUN !== 'false').
 *   - NEVER refunds without a matching DEBIT ledger row (an orphaned 'pending'
 *     claim that never debited is marked failed, never credited).
 *   - Refund is idempotent (REFUND_<request_id>; wallet RPCs reject duplicates).
 *   - Age window, batch cap, per-run refund cap, per-txn max-amount cap.
 */

import cron, { ScheduledTask } from 'node-cron'
import * as Sentry from '@sentry/nextjs'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { pay2newCheckStatus } from '@/services/pay2new'

const CRON_EXPRESSION = process.env.PAY2NEW_DIRECT_RECON_CRON || '*/5 * * * *'

function posInt(v: string | undefined, def: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : def
}

const CFG = {
  enabled: process.env.PAY2NEW_DIRECT_RECON_ENABLED !== 'false',
  dryRun: process.env.PAY2NEW_DIRECT_RECON_DRY_RUN !== 'false',
  minAgeMin: posInt(process.env.PAY2NEW_DIRECT_RECON_MIN_AGE_MIN, 15),
  maxAgeHours: posInt(process.env.PAY2NEW_DIRECT_RECON_MAX_AGE_HOURS, 72),
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
    const maxCreatedAt = new Date(nowMs - CFG.minAgeMin * 60_000).toISOString()
    const minCreatedAt = new Date(nowMs - CFG.maxAgeHours * 3_600_000).toISOString()

    const { data: candidates, error } = await supabase
      .from('pay2new_transactions')
      .select('id, user_id, user_role, request_id, product_code, product_name, amount, charge, total_debit, status, created_at')
      .eq('status', 'pending')
      .ilike('request_id', 'SDS%')
      .gt('created_at', minCreatedAt)
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

      // Still processing / fresh "no transaction found" → wait. A not-found is
      // only trusted once the txn is old enough (minAge window already enforces
      // this: candidates are ≥ minAgeMin old), so a not-found here is a genuine
      // never-charged payment and is safe to refund.
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
      `window=${CFG.minAgeMin}m..${CFG.maxAgeHours}h batch=${CFG.batch} ` +
      `maxAmount=₹${CFG.maxAmount} maxRefunds/run=${CFG.maxRefundsPerRun}`
  )
}

export function stopPay2NewDirectReconcileCron(): void {
  if (state.task) {
    state.task.stop()
    state.task = null
  }
}
