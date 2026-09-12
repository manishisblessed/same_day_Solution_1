/**
 * Pay2New (BBPS-2 Credit Card) stuck-debit reconciliation cron.
 *
 * WHY: The partner pay route debits the wallet BEFORE calling Pay2New. If that
 * call hangs/times out or the process restarts mid-request, the success- and
 * failure-handlers never run, leaving a debit with no order and no refund — the
 * partner is charged but the bill is never paid (see incident SDS1785484676100).
 *
 * WHAT: Every few minutes, look at recent pay2new debits that have neither a
 * recorded order nor a refund, ask Pay2New for the authoritative status, and:
 *   - SUCCESS  -> annotate the ledger row (OrderID) so we never re-check it.
 *   - FAILED / "No Transaction Found" / REFUNDED -> refund the partner wallet
 *     (idempotent, keyed on REFUND_<request_id>).
 *   - PENDING / provider unreachable -> leave it for the next cycle.
 *
 * SAFETY (this is money movement — defaults are deliberately conservative):
 *   - NEVER refunds on a local signal alone. Only a definitive provider verdict
 *     ("No Transaction Found" / order status failed) triggers a refund. Anything
 *     ambiguous stays PENDING and is skipped.
 *   - DRY-RUN by default (PAY2NEW_RECON_DRY_RUN !== 'false'): logs intended
 *     refunds without moving money. Non-financial success-annotation still runs
 *     so the working set drains and you can watch it operate safely.
 *   - Only acts inside an age window [MIN_AGE_MIN .. MAX_AGE_HOURS] so it never
 *     touches in-flight txns nor mass-sweeps the historical backlog.
 *   - Per-run batch cap, per-run refund cap, and per-txn max-amount cap. Amounts
 *     over the cap are logged/Sentry'd for manual review instead of auto-refunded.
 *   - Idempotent: refund_partner_wallet rejects a duplicate reference_id, and we
 *     pre-check for an existing REFUND_<id> before calling it.
 *
 * All knobs are env-driven; see CFG below.
 */

import cron, { ScheduledTask } from 'node-cron'
import * as Sentry from '@sentry/nextjs'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { pay2newCheckStatus } from '@/services/pay2new'

const CRON_EXPRESSION = process.env.PAY2NEW_RECON_CRON || '*/5 * * * *'

function posInt(v: string | undefined, def: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : def
}

const CFG = {
  // Master switch for scheduling the cron at all.
  enabled: process.env.PAY2NEW_RECON_ENABLED !== 'false',
  // Safe by default: log intended refunds, don't move money until explicitly off.
  dryRun: process.env.PAY2NEW_RECON_DRY_RUN !== 'false',
  // Don't touch txns younger than this (may still be completing at the provider).
  minAgeMin: posInt(process.env.PAY2NEW_RECON_MIN_AGE_MIN, 20),
  // Don't auto-act on txns older than this (historical backlog = manual review).
  maxAgeHours: posInt(process.env.PAY2NEW_RECON_MAX_AGE_HOURS, 72),
  // Candidates inspected per run.
  batch: posInt(process.env.PAY2NEW_RECON_BATCH, 25),
  // Refuse to auto-refund above this amount; flag for manual review instead.
  maxAmount: posInt(process.env.PAY2NEW_RECON_MAX_AMOUNT, 100000),
  // Hard cap on refunds executed per run (blast-radius limit).
  maxRefundsPerRun: posInt(process.env.PAY2NEW_RECON_MAX_REFUNDS_PER_RUN, 10),
  // Delay between provider status calls (don't hammer Pay2New).
  spacingMs: posInt(process.env.PAY2NEW_RECON_SPACING_MS, 350),
}

const g = globalThis as any
if (!g.__pay2newReconState) {
  g.__pay2newReconState = { task: null as ScheduledTask | null, isRunning: false }
}
const state = g.__pay2newReconState

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

    // Candidate = recent pay2new DEBIT, not already marked failed, with no order
    // recorded (no "OrderID:"/verified marker) and inside the age window. The
    // per-row refund check below confirms there is no existing refund.
    const { data: candidates, error } = await supabase
      .from('partner_wallet_ledger')
      .select('id, partner_id, reference_id, debit, description, created_at')
      .eq('service_type', 'pay2new')
      .eq('transaction_type', 'DEBIT')
      // Only real Pay2New API payments (request_id = "SDS<ts>"). Excludes manual
      // corrections/adjustments (e.g. CORRECTION_DEBIT_MANUAL) that share the
      // pay2new service_type but were never sent to the provider.
      .ilike('reference_id', 'SDS%')
      .neq('status', 'failed')
      .gt('created_at', minCreatedAt)
      .lt('created_at', maxCreatedAt)
      .not('description', 'ilike', '%OrderID:%')
      .not('description', 'ilike', '%ReconVerified%')
      .order('created_at', { ascending: true })
      .limit(CFG.batch)

    if (error) {
      console.error('[Pay2New-Recon] candidate query error:', error.message)
      return
    }
    if (!candidates || candidates.length === 0) return

    console.log(
      `[Pay2New-Recon] ${candidates.length} candidate(s)${CFG.dryRun ? ' [DRY-RUN]' : ''}`
    )

    for (const c of candidates) {
      const ref = c.reference_id
      if (!ref) continue

      // Belt-and-suspenders idempotency: skip if a refund already exists.
      const { data: existingRefund } = await supabase
        .from('partner_wallet_ledger')
        .select('id')
        .eq('partner_id', c.partner_id)
        .eq('reference_id', `REFUND_${ref}`)
        .limit(1)
        .maybeSingle()
      if (existingRefund) continue

      let res
      try {
        res = await pay2newCheckStatus({ request_id: ref })
      } catch (e: any) {
        console.error(`[Pay2New-Recon] status error ${ref}:`, e?.message)
        continue
      } finally {
        await sleep(CFG.spacingMs)
      }
      checked++

      // Provider unreachable / unparseable -> retry next cycle. Never refund.
      if (!res.success) continue

      // Provider confirms the payment exists and succeeded -> annotate & skip.
      if (res.status === 'SUCCESS') {
        const orderPart = res.order_id ? ` | OrderID:${res.order_id}` : ''
        const refPart = res.operator_reference ? ` | Ref:${res.operator_reference}` : ''
        await supabase
          .from('partner_wallet_ledger')
          .update({ description: `${c.description || ''}${orderPart}${refPart} | ReconVerified` })
          .eq('id', c.id)
        verified++
        continue
      }

      // Still processing or unknown -> wait, do not refund.
      if (res.status !== 'FAILED' && res.status !== 'REFUNDED') continue

      // ---- Definitive not-paid: partner is owed a refund ----
      const amount = Number(c.debit)
      if (!Number.isFinite(amount) || amount <= 0) continue

      if (amount > CFG.maxAmount) {
        console.error(
          `[Pay2New-Recon] MANUAL REVIEW: ${ref} not paid but ₹${amount} exceeds cap ₹${CFG.maxAmount}`
        )
        Sentry.captureMessage(
          `Pay2New stuck debit over auto-refund cap: ${ref} ₹${amount} partner=${c.partner_id}`,
          'warning'
        )
        continue
      }

      if (refunded >= CFG.maxRefundsPerRun) {
        console.warn(
          `[Pay2New-Recon] per-run refund cap (${CFG.maxRefundsPerRun}) reached; deferring the rest`
        )
        break
      }

      const reason =
        res.status === 'REFUNDED'
          ? 'provider reversed/refunded'
          : (res.error || 'provider: no transaction found / failed')

      if (CFG.dryRun) {
        console.log(
          `[Pay2New-Recon] DRY-RUN would refund ₹${amount} ref=${ref} partner=${c.partner_id} (${reason})`
        )
        continue
      }

      const { error: refundErr } = await supabase.rpc('refund_partner_wallet', {
        p_partner_id: c.partner_id,
        p_amount: amount,
        p_payout_transaction_id: null,
        p_description: `${c.description || 'BBPS-2 CC'} — auto-refund: ${reason} (recon)`,
        p_reference_id: `REFUND_${ref}`,
        p_service_type: 'pay2new',
      })

      if (refundErr) {
        if (/duplicate/i.test(refundErr.message || '')) {
          // Raced with another path; already refunded.
          continue
        }
        console.error(`[Pay2New-Recon] CRITICAL refund failed ${ref}:`, refundErr.message)
        Sentry.captureException(new Error(`Pay2New recon refund failed ${ref}: ${refundErr.message}`))
        continue
      }

      refunded++
      console.log(`[Pay2New-Recon] REFUNDED ₹${amount} ref=${ref} partner=${c.partner_id} (${reason})`)
    }
  } catch (e: any) {
    console.error('[Pay2New-Recon] run error:', e?.message)
    Sentry.captureException(e)
  } finally {
    state.isRunning = false
    console.log(
      `[Pay2New-Recon] done: checked=${checked} verified=${verified} refunded=${refunded}` +
        `${CFG.dryRun ? ' (DRY-RUN)' : ''} in ${Date.now() - startedAt}ms`
    )
  }
}

export async function initPay2NewReconcileCron(): Promise<void> {
  if (!CFG.enabled) {
    console.log('[Pay2New-Recon] disabled (PAY2NEW_RECON_ENABLED=false); not scheduling')
    return
  }
  if (state.task) {
    state.task.stop()
    state.task = null
  }
  state.task = cron.schedule(CRON_EXPRESSION, runCheck, { timezone: 'Asia/Kolkata' })
  console.log(
    `[Pay2New-Recon] scheduled (${CRON_EXPRESSION}) dryRun=${CFG.dryRun} ` +
      `window=${CFG.minAgeMin}m..${CFG.maxAgeHours}h batch=${CFG.batch} ` +
      `maxAmount=₹${CFG.maxAmount} maxRefunds/run=${CFG.maxRefundsPerRun}`
  )
}

export function stopPay2NewReconcileCron(): void {
  if (state.task) {
    state.task.stop()
    state.task = null
  }
}
