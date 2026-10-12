/**
 * Pay2New (BBPS-2) FALSE-REFUND standing recovery cron.
 *
 * WHY: When a refund is proven false (vendor actually SUCCEEDED) but the partner
 * wallet can't cover the full clawback right now, we can't recover immediately.
 * Instead the debit is marked "FalseRefundConfirmed(...)RecoveryPending" and this
 * cron recovers it later — the EXACT per-transaction amount, one by one, the
 * moment the partner's balance covers it. No lump sums, no forced-negative.
 *
 * WHAT: Every few minutes, for each confirmed-but-unrecovered false refund:
 *   - RE-VERIFY the vendor still says SUCCESS (belt-and-suspenders safety).
 *   - If the partner balance >= the exact original debit -> idempotent CLAWBACK_
 *     re-debit (reverses the wrong refund) and annotate the row ReconVerified.
 *   - Else leave it for a later cycle (balance not yet available).
 *
 * SAFETY:
 *   - Only touches rows explicitly tagged FalseRefundConfirmed (admin/sweep put
 *     them in the queue). Never scans/guesses.
 *   - Clawbacks only on a FRESH vendor SUCCESS. Never on ambiguity.
 *   - Idempotent: debit_partner_wallet rejects a duplicate CLAWBACK_<id>, and we
 *     pre-check for it. Re-runs never double-debit.
 *   - DRY-RUN by default (PAY2NEW_CLAWBACK_DRY_RUN !== 'false').
 *   - Per-run action cap + spacing (blast-radius limit; don't hammer the vendor).
 */

import cron, { ScheduledTask } from 'node-cron'
import * as Sentry from '@sentry/nextjs'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { pay2newCheckStatus } from '@/services/pay2new'

const CRON_EXPRESSION = process.env.PAY2NEW_CLAWBACK_CRON || '*/10 * * * *'

function posInt(v: string | undefined, def: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : def
}

const CFG = {
  enabled: process.env.PAY2NEW_CLAWBACK_ENABLED !== 'false',
  // Safe by default: log intended clawbacks, don't move money until explicitly off.
  dryRun: process.env.PAY2NEW_CLAWBACK_DRY_RUN !== 'false',
  // How far back to look for queued confirmed false refunds.
  lookbackDays: posInt(process.env.PAY2NEW_CLAWBACK_LOOKBACK_DAYS, 180),
  // Candidates inspected per run.
  batch: posInt(process.env.PAY2NEW_CLAWBACK_BATCH, 50),
  // Refuse to auto-claw above this single-txn amount (manual review instead).
  maxAmount: posInt(process.env.PAY2NEW_CLAWBACK_MAX_AMOUNT, 100000),
  // Hard cap on clawbacks executed per run.
  maxActionsPerRun: posInt(process.env.PAY2NEW_CLAWBACK_MAX_ACTIONS_PER_RUN, 10),
  // Delay between provider status calls.
  spacingMs: posInt(process.env.PAY2NEW_CLAWBACK_SPACING_MS, 350),
}

const g = globalThis as any
if (!g.__pay2newClawbackState) {
  g.__pay2newClawbackState = { task: null as ScheduledTask | null, isRunning: false }
}
const state = g.__pay2newClawbackState

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function runCheck(): Promise<void> {
  if (state.isRunning) return
  state.isRunning = true
  const startedAt = Date.now()

  let checked = 0
  let recovered = 0
  let recoveredAmount = 0
  let skippedBalance = 0

  try {
    const supabase = getSupabaseAdmin()
    const minCreatedAt = new Date(Date.now() - CFG.lookbackDays * 864e5).toISOString()

    // Candidate = a pay2new DEBIT explicitly confirmed as a false refund and not
    // yet clawed back. (Tagged by the sweep / admin when full recovery couldn't
    // run due to insufficient balance.)
    const { data: candidates, error } = await supabase
      .from('partner_wallet_ledger')
      .select('id, partner_id, reference_id, debit, description, created_at')
      .eq('service_type', 'pay2new')
      .eq('transaction_type', 'DEBIT')
      .ilike('reference_id', 'SDS%')
      .ilike('description', '%FalseRefundConfirmed%')
      .not('description', 'ilike', '%ReconVerified(clawback)%')
      .gt('created_at', minCreatedAt)
      .order('created_at', { ascending: true })
      .limit(CFG.batch)

    if (error) {
      console.error('[Pay2New-Clawback] candidate query error:', error.message)
      return
    }
    if (!candidates || candidates.length === 0) {
      console.log('[Pay2New-Clawback] no queued false refunds pending recovery')
      return
    }

    console.log(`[Pay2New-Clawback] ${candidates.length} queued candidate(s)${CFG.dryRun ? ' [DRY-RUN]' : ''}`)

    for (const c of candidates) {
      if (recovered >= CFG.maxActionsPerRun) break
      const ref = c.reference_id as string
      const amount = Number(c.debit)
      if (!ref || !(amount > 0)) continue
      if (amount > CFG.maxAmount) {
        console.warn(`[Pay2New-Clawback] ${ref} ₹${amount} exceeds maxAmount — skipping (manual)`)
        continue
      }

      // Already clawed back? (belt-and-suspenders)
      const { data: already } = await supabase
        .from('partner_wallet_ledger')
        .select('id').eq('partner_id', c.partner_id).eq('reference_id', `CLAWBACK_${ref}`).limit(1).maybeSingle()
      if (already) continue

      // There must be a refund to reverse.
      const { data: refundRow } = await supabase
        .from('partner_wallet_ledger')
        .select('id').eq('partner_id', c.partner_id).eq('reference_id', `REFUND_${ref}`).limit(1).maybeSingle()
      if (!refundRow) continue

      // FRESH vendor re-verify — only a definitive SUCCESS justifies a clawback.
      let st
      try {
        st = await pay2newCheckStatus({ request_id: ref })
      } catch (e: any) {
        console.error(`[Pay2New-Clawback] status error ${ref}:`, e?.message)
        continue
      } finally {
        await sleep(CFG.spacingMs)
      }
      checked++
      if (!st.success || st.status !== 'SUCCESS') {
        console.log(`[Pay2New-Clawback] ${ref} vendor=${st.success ? st.status : 'UNREACHABLE'} — not SUCCESS, skip`)
        continue
      }

      // Balance available for the EXACT amount?
      const { data: wallet } = await supabase
        .from('partner_wallets').select('balance, is_frozen').eq('partner_id', c.partner_id).maybeSingle()
      const bal = Number(wallet?.balance || 0)
      if (wallet?.is_frozen) { console.log(`[Pay2New-Clawback] ${ref} partner frozen — skip`); continue }
      if (bal < amount) { skippedBalance++; continue }

      if (CFG.dryRun) {
        console.log(`[Pay2New-Clawback] WOULD recover ${ref} ₹${amount} (bal ₹${bal}) order=${st.order_id || '-'}`)
        recovered++
        recoveredAmount += amount
        continue
      }

      // Idempotent clawback (reverse the wrong refund) + annotate.
      const { error: rpcErr } = await supabase.rpc('debit_partner_wallet', {
        p_partner_id: c.partner_id,
        p_amount: amount,
        p_payout_transaction_id: null,
        p_description: `BBPS-2 clawback of false refund — vendor SUCCESS | orig ${ref}`,
        p_reference_id: `CLAWBACK_${ref}`,
        p_service_type: 'pay2new',
      })
      if (rpcErr) {
        if (/insufficient/i.test(rpcErr.message || '')) { skippedBalance++; continue }
        if (!/duplicate/i.test(rpcErr.message || '')) {
          console.error(`[Pay2New-Clawback] ${ref} clawback failed:`, rpcErr.message)
          Sentry.captureMessage(`Pay2New clawback failed ${ref}: ${rpcErr.message}`, 'warning')
          continue
        }
      }
      await supabase
        .from('partner_wallet_ledger')
        .update({
          status: 'completed',
          description: `${c.description || ''} | OrderID:${st.order_id || 'N/A'} | Ref:${st.operator_reference || 'N/A'} | ReconVerified(clawback)`,
        })
        .eq('id', c.id)
        .not('description', 'ilike', '%ReconVerified(clawback)%')

      recovered++
      recoveredAmount += amount
      console.log(`[Pay2New-Clawback] ✓ recovered ${ref} ₹${amount} via CLAWBACK_${ref}`)
    }
  } catch (e: any) {
    console.error('[Pay2New-Clawback] run error:', e?.message)
    Sentry.captureException(e)
  } finally {
    state.isRunning = false
    console.log(
      `[Pay2New-Clawback] done: checked=${checked} recovered=${recovered} (₹${recoveredAmount}) ` +
        `waitingOnBalance=${skippedBalance}${CFG.dryRun ? ' (DRY-RUN)' : ''} in ${Date.now() - startedAt}ms`
    )
  }
}

export async function initPay2NewClawbackRecoveryCron(): Promise<void> {
  if (!CFG.enabled) {
    console.log('[Pay2New-Clawback] disabled (PAY2NEW_CLAWBACK_ENABLED=false); not scheduling')
    return
  }
  if (state.task) {
    state.task.stop()
    state.task = null
  }
  state.task = cron.schedule(CRON_EXPRESSION, runCheck, { timezone: 'Asia/Kolkata' })
  console.log(
    `[Pay2New-Clawback] scheduled (${CRON_EXPRESSION}) dryRun=${CFG.dryRun} ` +
      `lookback=${CFG.lookbackDays}d batch=${CFG.batch} maxAmount=₹${CFG.maxAmount} maxActions/run=${CFG.maxActionsPerRun}`
  )
}

export function stopPay2NewClawbackRecoveryCron(): void {
  if (state.task) {
    state.task.stop()
    state.task = null
  }
}
