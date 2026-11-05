/**
 * Pay2New (BBPS-2) invariant monitor.
 *
 * The permanent guarantee the whole redesign rests on is: the partner-facing
 * STATE must never diverge from the MONEY, and the money must never move without
 * leaving a terminal state the partner can see. This cron is the safety net that
 * makes that guarantee observable and self-healing:
 *
 *   A) DRIFT HEAL — reads the `pay2new_state_drift` view (money moved but the
 *      projected state disagrees — e.g. a REFUND_/CLAWBACK_ marker exists but the
 *      trigger projection somehow didn't land) and repairs the projected state.
 *      Non-financial: it only corrects pay2new_payments.state; it never moves
 *      money. Each heal is reported to Sentry so a recurring source is visible.
 *
 *   B) RECOVERY DETECTION (the irreducible gap) — for payments we marked REFUNDED,
 *      re-confirms against Pay2New. If the vendor now reports SUCCESS (the card
 *      WAS charged → our refund was false), it opens a `pay2new_recovery_claims`
 *      row linking the refund evidence and the fresh SUCCESS evidence, so the loss
 *      is captured and claimable from Pay2New. Money recovery (the clawback) is
 *      left to the dedicated false-refund / clawback crons under their guards.
 *
 * This cron NEVER moves money, so it has no dry-run gate.
 */

import cron, { ScheduledTask } from 'node-cron'
import * as Sentry from '@sentry/nextjs'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { checkStatusWithLog } from '@/lib/pay2new/status-log'
import { openRecoveryClaim } from '@/lib/pay2new/state-machine'

const CRON_EXPRESSION = process.env.PAY2NEW_INVARIANT_MONITOR_CRON || '*/10 * * * *'

function posInt(v: string | undefined, def: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : def
}

const CFG = {
  enabled: process.env.PAY2NEW_INVARIANT_MONITOR_ENABLED !== 'false',
  // Drift rows self-healed per run (non-financial).
  driftBatch: posInt(process.env.PAY2NEW_INVARIANT_DRIFT_BATCH, 200),
  // REFUNDED payments re-confirmed against the vendor per run (bounded cost).
  recoveryBatch: posInt(process.env.PAY2NEW_INVARIANT_RECOVERY_BATCH, 25),
  // Only look back this far for recovery re-confirmation.
  recoveryLookbackDays: posInt(process.env.PAY2NEW_INVARIANT_RECOVERY_LOOKBACK_DAYS, 30),
  // Don't re-probe a refund younger than this (let it settle / avoid noise).
  recoveryMinAgeMin: posInt(process.env.PAY2NEW_INVARIANT_RECOVERY_MIN_AGE_MIN, 30),
  // Delay between vendor status calls.
  spacingMs: posInt(process.env.PAY2NEW_INVARIANT_SPACING_MS, 350),
}

const g = globalThis as any
if (!g.__pay2newInvariantMonitorState) {
  g.__pay2newInvariantMonitorState = { task: null as ScheduledTask | null, isRunning: false }
}
const state = g.__pay2newInvariantMonitorState

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface DriftRow {
  request_id: string
  partner_id: string | null
  state: string
  total_debit: number | null
  has_refund: boolean | null
  has_clawback: boolean | null
  order_id: string | null
}

async function healDrift(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<number> {
  const { data, error } = await supabase
    .from('pay2new_state_drift')
    .select('request_id, partner_id, state, total_debit, has_refund, has_clawback, order_id')
    .limit(CFG.driftBatch)

  if (error) {
    console.error('[Pay2New-Monitor] drift query error:', error.message)
    return 0
  }
  const rows = (data || []) as DriftRow[]
  let healed = 0
  for (const d of rows) {
    // Recompute the correct terminal state from the money markers (truth).
    const correct = d.has_clawback
      ? 'SUCCESS'
      : d.order_id
        ? 'SUCCESS'
        : d.has_refund
          ? 'REFUNDED'
          : null
    if (!correct || correct === d.state) continue

    const { error: upErr } = await supabase
      .from('pay2new_payments')
      .update({ state: correct })
      .eq('request_id', d.request_id)
    if (upErr) {
      console.error(`[Pay2New-Monitor] heal failed ${d.request_id}:`, upErr.message)
      continue
    }
    healed++
    console.warn(`[Pay2New-Monitor] DRIFT HEALED ${d.request_id}: ${d.state} -> ${correct}`)
    Sentry.captureMessage(
      `Pay2New state drift healed: ${d.request_id} ${d.state} -> ${correct} partner=${d.partner_id ?? '?'}`,
      'warning'
    )
  }
  return healed
}

interface RefundedRow {
  request_id: string
  partner_id: string | null
  amount: number | null
  total_debit: number | null
  order_id: string | null
  refund_at: string | null
  refund_evidence_id: number | null
}

async function detectRecoveries(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<number> {
  const sinceIso = new Date(Date.now() - CFG.recoveryLookbackDays * 864e5).toISOString()
  const olderThanIso = new Date(Date.now() - CFG.recoveryMinAgeMin * 60_000).toISOString()

  const { data, error } = await supabase
    .from('pay2new_payments')
    .select('request_id, partner_id, amount, total_debit, order_id, refund_at, refund_evidence_id')
    .eq('state', 'REFUNDED')
    .gte('created_at', sinceIso)
    .order('refund_at', { ascending: false })
    .limit(CFG.recoveryBatch)

  if (error) {
    console.error('[Pay2New-Monitor] recovery query error:', error.message)
    return 0
  }
  const rows = (data || []) as RefundedRow[]
  let claims = 0
  for (const r of rows) {
    // Skip refunds too fresh to re-confirm.
    if (r.refund_at && r.refund_at > olderThanIso) continue

    // Skip if a claim already exists (idempotent; avoids re-probing the vendor).
    const { data: existing } = await supabase
      .from('pay2new_recovery_claims')
      .select('id')
      .eq('request_id', r.request_id)
      .maybeSingle()
    if (existing) continue

    let up
    try {
      up = await checkStatusWithLog(supabase, { request_id: r.request_id }, 'monitor')
    } catch (e: any) {
      console.error(`[Pay2New-Monitor] vendor probe error ${r.request_id}:`, e?.message)
      continue
    } finally {
      await sleep(CFG.spacingMs)
    }

    // Only a definitive vendor SUCCESS contradicts our REFUNDED (false refund).
    if (up.success && up.status === 'SUCCESS') {
      const opened = await openRecoveryClaim(supabase, {
        requestId: r.request_id,
        partnerId: r.partner_id,
        amount: r.total_debit ?? r.amount,
        priorState: 'REFUNDED',
        vendorState: 'SUCCESS',
        refundEvidenceId: r.refund_evidence_id,
        successEvidenceId: up.evidenceId,
        orderId: up.order_id ?? null,
        operatorReference: up.operator_reference ?? null,
        notes: 'auto-detected by invariant monitor: vendor SUCCESS on a REFUNDED payment',
      })
      if (opened) {
        claims++
        Sentry.captureMessage(
          `Pay2New recovery claim opened (false refund): ${r.request_id} ` +
            `amount=${r.total_debit ?? r.amount ?? '?'} partner=${r.partner_id ?? '?'}`,
          'warning'
        )
      }
    }
  }
  return claims
}

async function runCheck(): Promise<void> {
  if (state.isRunning) return
  state.isRunning = true
  const startedAt = Date.now()
  let healed = 0
  let claims = 0
  try {
    const supabase = getSupabaseAdmin()
    healed = await healDrift(supabase)
    claims = await detectRecoveries(supabase)
  } catch (e: any) {
    console.error('[Pay2New-Monitor] run error:', e?.message)
    Sentry.captureException(e)
  } finally {
    state.isRunning = false
    if (healed || claims) {
      console.log(
        `[Pay2New-Monitor] done: driftHealed=${healed} recoveryClaims=${claims} in ${Date.now() - startedAt}ms`
      )
    }
  }
}

export async function initPay2NewInvariantMonitorCron(): Promise<void> {
  if (!CFG.enabled) {
    console.log('[Pay2New-Monitor] disabled (PAY2NEW_INVARIANT_MONITOR_ENABLED=false); not scheduling')
    return
  }
  if (state.task) {
    state.task.stop()
    state.task = null
  }
  state.task = cron.schedule(CRON_EXPRESSION, runCheck, { timezone: 'Asia/Kolkata' })
  console.log(
    `[Pay2New-Monitor] scheduled (${CRON_EXPRESSION}) driftBatch=${CFG.driftBatch} ` +
      `recoveryBatch=${CFG.recoveryBatch} recoveryLookback=${CFG.recoveryLookbackDays}d`
  )
}

export function stopPay2NewInvariantMonitorCron(): void {
  if (state.task) {
    state.task.stop()
    state.task = null
  }
}
