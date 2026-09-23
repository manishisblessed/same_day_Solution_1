/**
 * Rechargekit (CC-2 / RKCC) stuck-transaction reconciliation cron.
 *
 * WHY: Rechargekit CC payments are finalized by an async callback
 * (`/api/rechargekit/callback`). If the callback never arrives (provider didn't
 * fire it, endpoint/secret misconfig, process restart mid-flight), the row stays
 * `pending` forever — the retailer is debited but the txn is never settled or
 * refunded. Previously the only recovery was a manual admin "Check" click, and
 * that path was itself broken for RKCC rows.
 *
 * WHAT: Every few minutes, take recent `bbps_transactions` RKCC rows still in a
 * non-final state, ask Rechargekit for the authoritative status, and finalize
 * via the SAME shared logic the callback uses:
 *   - status 1 (SUCCESS) -> mark success + distribute commissions
 *   - status 3 (FAILED)  -> mark failed + refund wallet (idempotent)
 *   - status 2 (PENDING) / provider unreachable -> leave for next cycle
 *
 * SAFETY (money movement):
 *   - Only acts on definitive provider verdicts (status 1 or 3). Anything
 *     ambiguous stays pending.
 *   - Age window [MIN_AGE_MIN .. MAX_AGE_HOURS] so it never touches in-flight
 *     txns nor mass-sweeps ancient history.
 *   - Per-run batch cap, per-run action cap, and per-txn max-amount cap. Refunds
 *     above the cap are logged/Sentry'd for manual review instead of auto-run.
 *   - Idempotent: finalize uses deterministic ledger reference_ids
 *     (RKCC_COMM_<id>, REFUND_<id>); the DB unique index is the hard backstop.
 *   - DRY-RUN switch (default OFF here since Rechargekit returns explicit status
 *     codes): when on, logs intended actions without moving money.
 *
 * All knobs are env-driven; see CFG below.
 */

import cron, { ScheduledTask } from 'node-cron'
import * as Sentry from '@sentry/nextjs'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { rechargekitStatusCheck } from '@/services/rechargekit/statusCheck'
import { finalizeRechargekitRetailerTxn } from '@/services/rechargekit/finalize'

const CRON_EXPRESSION = process.env.RECHARGEKIT_RECON_CRON || '*/5 * * * *'

function posInt(v: string | undefined, def: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : def
}

const CFG = {
  enabled: process.env.RECHARGEKIT_RECON_ENABLED !== 'false',
  // Live by default: Rechargekit returns explicit status codes (1/2/3), so we
  // only ever act on a definitive verdict. Set RECHARGEKIT_RECON_DRY_RUN=true to
  // observe without moving money.
  dryRun: process.env.RECHARGEKIT_RECON_DRY_RUN === 'true',
  // Don't touch txns younger than this (callback may still be arriving).
  minAgeMin: posInt(process.env.RECHARGEKIT_RECON_MIN_AGE_MIN, 15),
  // Don't auto-act on txns older than this (historical backlog = manual review).
  maxAgeHours: posInt(process.env.RECHARGEKIT_RECON_MAX_AGE_HOURS, 72),
  // Candidates inspected per run.
  batch: posInt(process.env.RECHARGEKIT_RECON_BATCH, 25),
  // Refuse to auto-refund above this bill amount; flag for manual review instead.
  maxAmount: posInt(process.env.RECHARGEKIT_RECON_MAX_AMOUNT, 200000),
  // Hard cap on finalize actions (success or refund) executed per run.
  maxActionsPerRun: posInt(process.env.RECHARGEKIT_RECON_MAX_ACTIONS_PER_RUN, 15),
  // Delay between provider status calls (don't hammer Rechargekit).
  spacingMs: posInt(process.env.RECHARGEKIT_RECON_SPACING_MS, 350),
}

const g = globalThis as any
if (!g.__rechargekitReconState) {
  g.__rechargekitReconState = { task: null as ScheduledTask | null, isRunning: false }
}
const state = g.__rechargekitReconState

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function runCheck(): Promise<void> {
  if (state.isRunning) return
  state.isRunning = true
  const startedAt = Date.now()

  let checked = 0
  let succeeded = 0
  let refunded = 0
  let actions = 0

  try {
    const supabase = getSupabaseAdmin()
    const nowMs = Date.now()
    const maxCreatedAt = new Date(nowMs - CFG.minAgeMin * 60_000).toISOString()
    const minCreatedAt = new Date(nowMs - CFG.maxAgeHours * 3_600_000).toISOString()

    const { data: candidates, error } = await supabase
      .from('bbps_transactions')
      .select('id, status, retailer_id, agent_transaction_id, transaction_id, bill_amount, scheme_id, additional_info, created_at')
      .ilike('agent_transaction_id', 'RKCC%')
      .in('status', ['pending', 'processing', 'initiated'])
      .gt('created_at', minCreatedAt)
      .lt('created_at', maxCreatedAt)
      .order('created_at', { ascending: true })
      .limit(CFG.batch)

    if (error) {
      console.error('[Rechargekit-Recon] candidate query error:', error.message)
      return
    }
    if (!candidates || candidates.length === 0) return

    console.log(
      `[Rechargekit-Recon] ${candidates.length} candidate(s)${CFG.dryRun ? ' [DRY-RUN]' : ''}`
    )

    for (const c of candidates) {
      const ref = c.agent_transaction_id as string
      if (!ref) continue

      if (actions >= CFG.maxActionsPerRun) {
        console.warn(
          `[Rechargekit-Recon] per-run action cap (${CFG.maxActionsPerRun}) reached; deferring the rest`
        )
        break
      }

      let live
      try {
        live = await rechargekitStatusCheck(ref)
      } finally {
        await sleep(CFG.spacingMs)
      }
      checked++

      // Provider unreachable / unparseable or still pending -> retry next cycle.
      if (!live.ok || ![1, 3].includes(live.status)) continue

      const amount = Number(c.bill_amount)

      // Cap only gates the auto-refund (FAILED) path — a definitive not-paid.
      if (live.status === 3 && Number.isFinite(amount) && amount > CFG.maxAmount) {
        console.error(
          `[Rechargekit-Recon] MANUAL REVIEW: ${ref} failed but ₹${amount} exceeds cap ₹${CFG.maxAmount}`
        )
        Sentry.captureMessage(
          `Rechargekit stuck txn over auto-refund cap: ${ref} ₹${amount} retailer=${c.retailer_id}`,
          'warning'
        )
        continue
      }

      if (CFG.dryRun) {
        console.log(
          `[Rechargekit-Recon] DRY-RUN would finalize ref=${ref} providerStatus=${live.status} ` +
            `(${live.status === 1 ? 'SUCCESS' : 'FAILED+refund'}) amount=₹${amount}`
        )
        continue
      }

      try {
        const result = await finalizeRechargekitRetailerTxn(
          supabase,
          c as any,
          ref,
          live.status,
          live.orderId || ref,
          live.operatorRef,
          live.msg
        )
        actions++
        if (result.action === 'marked_success') {
          succeeded++
          console.log(`[Rechargekit-Recon] SUCCESS ref=${ref} retailer=${c.retailer_id}`)
        } else if (result.action === 'failed_and_refunded') {
          refunded++
          console.log(
            `[Rechargekit-Recon] FAILED + REFUNDED ₹${result.refundedAmount} ref=${ref} retailer=${c.retailer_id}`
          )
        }
      } catch (e: any) {
        console.error(`[Rechargekit-Recon] finalize error ${ref}:`, e?.message)
        Sentry.captureException(new Error(`Rechargekit recon finalize failed ${ref}: ${e?.message}`))
      }
    }
  } catch (e: any) {
    console.error('[Rechargekit-Recon] run error:', e?.message)
    Sentry.captureException(e)
  } finally {
    state.isRunning = false
    console.log(
      `[Rechargekit-Recon] done: checked=${checked} success=${succeeded} refunded=${refunded}` +
        `${CFG.dryRun ? ' (DRY-RUN)' : ''} in ${Date.now() - startedAt}ms`
    )
  }
}

export async function initRechargekitReconcileCron(): Promise<void> {
  if (!CFG.enabled) {
    console.log('[Rechargekit-Recon] disabled (RECHARGEKIT_RECON_ENABLED=false); not scheduling')
    return
  }
  if (state.task) {
    state.task.stop()
    state.task = null
  }
  state.task = cron.schedule(CRON_EXPRESSION, runCheck, { timezone: 'Asia/Kolkata' })
  console.log(
    `[Rechargekit-Recon] scheduled (${CRON_EXPRESSION}) dryRun=${CFG.dryRun} ` +
      `window=${CFG.minAgeMin}m..${CFG.maxAgeHours}h batch=${CFG.batch} ` +
      `maxAmount=₹${CFG.maxAmount} maxActions/run=${CFG.maxActionsPerRun}`
  )
}

export function stopRechargekitReconcileCron(): void {
  if (state.task) {
    state.task.stop()
    state.task = null
  }
}
