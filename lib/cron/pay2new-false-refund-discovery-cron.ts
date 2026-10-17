/**
 * Pay2New (BBPS-2 Credit Card) FALSE-REFUND DISCOVERY cron.
 *
 * WHY: The recon cron refunds a stuck debit on a definitive vendor FAILED/
 * REFUNDED verdict and then marks the debit `failed` — after which it is NEVER
 * re-checked. If the vendor LATER flips that same txn to SUCCESS (a vendor-side
 * reversal/correction), we have refunded the partner AND the card was actually
 * paid = a silent double-pay / loss. Nothing automated discovers this today; it
 * was a manual sweep (scripts/pay2new-false-refund-sweep.cjs). This cron is the
 * scheduled, capped, safe version of that discovery.
 *
 * WHAT: Every few hours, for each pay2new DEBIT that we refunded (REFUND_<id>
 * exists) but have NOT yet clawed back (no CLAWBACK_<id>) and have NOT yet
 * queued (no FalseRefundConfirmed), ask Pay2New for the authoritative status:
 *   - vendor SUCCESS  -> this refund was FALSE (real loss). Recover it:
 *        * partner balance covers the exact amount -> idempotent CLAWBACK_
 *          re-debit (reverses the wrong refund), annotate the row SUCCESS, and
 *          push a SUCCESS webhook so the partner flips refunded -> success.
 *        * balance short / wallet frozen -> tag `FalseRefundConfirmed...Recovery
 *          Pending` and hand off to the standing pay2new-clawback-recovery cron,
 *          which re-debits the exact amount one-by-one the moment balance covers it.
 *   - anything else (REFUNDED / FAILED / NOT_FOUND / PENDING / unreachable)
 *        -> do nothing; the refund stands. Re-check next cycle.
 *
 * SAFETY (never auto-reverse a correct refund):
 *   - Acts ONLY on a FRESH, definitive vendor SUCCESS. Ambiguity is left alone.
 *   - Idempotent: debit_partner_wallet rejects a duplicate CLAWBACK_<id>, and we
 *     pre-check for it. Re-runs never double-debit.
 *   - DRY-RUN by default (PAY2NEW_FALSE_REFUND_DISCOVERY_DRY_RUN !== 'false'):
 *     logs intended clawbacks without moving money.
 *   - Per-run batch cap, per-run action cap, per-txn max-amount cap. Over-cap
 *     amounts are logged/Sentry'd for manual review instead of auto-clawed.
 *   - Partner ledger only (matches the standing recovery cron's domain for a
 *     clean handoff). Retailer/in-app false refunds remain the manual sweep.
 *
 * All knobs are env-driven; see CFG below.
 */

import cron, { ScheduledTask } from 'node-cron'
import * as Sentry from '@sentry/nextjs'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { pay2newCheckStatus } from '@/services/pay2new'
import { deliverPartnerCallbackByPartnerId } from '@/lib/partner-webhook/deliver'
import { buildPay2NewStatusPayload, type Pay2NewTerminalStatus } from '@/lib/partner-webhook/pay2new-payload'

/** Parse "₹<bill> + ₹<charge> charge" out of a ledger description. */
function parseAmounts(desc: string | null): { amount: number | null; charge: number | null } {
  const m = desc?.match(/₹([\d.]+)\s*\+\s*₹([\d.]+)\s*charge/)
  return { amount: m ? parseFloat(m[1]) : null, charge: m ? parseFloat(m[2]) : null }
}

/** Push a terminal pay state to the owning partner (signed, retried, logged). */
function emitWebhook(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  partnerId: string,
  args: {
    billFetchRef: string | null
    requestId: string
    orderId: string | null
    status: Pay2NewTerminalStatus
    amount: number | null
    charge: number | null
    operatorReference: string | null
    message?: string | null
  }
): void {
  const payload = buildPay2NewStatusPayload(args)
  void deliverPartnerCallbackByPartnerId({
    supabase,
    partnerId,
    txnId: args.requestId,
    payload,
    event: 'pay2new.cc.status',
    logPrefix: 'Pay2New-FalseRefundDiscovery Callback',
  }).catch(() => {})
}

const CRON_EXPRESSION = process.env.PAY2NEW_FALSE_REFUND_DISCOVERY_CRON || '7 */2 * * *'

function posInt(v: string | undefined, def: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : def
}

const CFG = {
  enabled: process.env.PAY2NEW_FALSE_REFUND_DISCOVERY_ENABLED !== 'false',
  // Safe by default: log intended clawbacks, don't move money until explicitly off.
  dryRun: process.env.PAY2NEW_FALSE_REFUND_DISCOVERY_DRY_RUN !== 'false',
  // How far back to scan refunded debits.
  lookbackDays: posInt(process.env.PAY2NEW_FALSE_REFUND_DISCOVERY_LOOKBACK_DAYS, 180),
  // Candidates inspected per run (split half newest-first, half oldest-first).
  batch: posInt(process.env.PAY2NEW_FALSE_REFUND_DISCOVERY_BATCH, 50),
  // Refuse to auto-claw above this single-txn amount (manual review instead).
  maxAmount: posInt(process.env.PAY2NEW_FALSE_REFUND_DISCOVERY_MAX_AMOUNT, 100000),
  // Hard cap on clawbacks executed per run (blast-radius limit).
  maxActionsPerRun: posInt(process.env.PAY2NEW_FALSE_REFUND_DISCOVERY_MAX_ACTIONS_PER_RUN, 10),
  // Delay between provider status calls (don't hammer Pay2New).
  spacingMs: posInt(process.env.PAY2NEW_FALSE_REFUND_DISCOVERY_SPACING_MS, 350),
}

const g = globalThis as any
if (!g.__pay2newFalseRefundDiscoveryState) {
  g.__pay2newFalseRefundDiscoveryState = { task: null as ScheduledTask | null, isRunning: false }
}
const state = g.__pay2newFalseRefundDiscoveryState

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function runCheck(): Promise<void> {
  if (state.isRunning) return
  state.isRunning = true
  const startedAt = Date.now()

  let checked = 0
  let recovered = 0
  let recoveredAmount = 0
  let queued = 0

  try {
    const supabase = getSupabaseAdmin()
    const minCreatedAt = new Date(Date.now() - CFG.lookbackDays * 864e5).toISOString()

    // Candidate = a pay2new DEBIT already resolved as `failed` (the recon marks a
    // refunded debit failed), SDS<ts> only, within lookback, NOT already queued
    // (FalseRefundConfirmed -> owned by the recovery cron) and NOT already clawed
    // (ReconVerified(clawback)). The per-row checks below confirm a REFUND_ exists
    // and no CLAWBACK_ exists before any money moves.
    const buildCandidateQuery = () =>
      supabase
        .from('partner_wallet_ledger')
        .select('id, partner_id, reference_id, debit, description, created_at, bill_fetch_ref')
        .eq('service_type', 'pay2new')
        .eq('transaction_type', 'DEBIT')
        .eq('status', 'failed')
        .ilike('reference_id', 'SDS%')
        .gt('created_at', minCreatedAt)
        .not('description', 'ilike', '%FalseRefundConfirmed%')
        .not('description', 'ilike', '%ReconVerified(clawback)%')

    // Newest-first AND oldest-first in the same tick (same rationale as recon):
    // fresh disputes resolve promptly while the historical backlog still drains.
    const half = Math.max(1, Math.floor(CFG.batch / 2))
    const [recentRes, oldRes] = await Promise.all([
      buildCandidateQuery().order('created_at', { ascending: false }).limit(half),
      buildCandidateQuery().order('created_at', { ascending: true }).limit(CFG.batch - half),
    ])
    const error = recentRes.error || oldRes.error
    const seenIds = new Set<string>()
    const candidates = [...(recentRes.data || []), ...(oldRes.data || [])].filter((r: any) => {
      if (seenIds.has(r.id)) return false
      seenIds.add(r.id)
      return true
    })

    if (error) {
      console.error('[Pay2New-FalseRefundDiscovery] candidate query error:', error.message)
      return
    }
    if (!candidates || candidates.length === 0) return

    console.log(
      `[Pay2New-FalseRefundDiscovery] ${candidates.length} candidate(s)${CFG.dryRun ? ' [DRY-RUN]' : ''}`
    )

    for (const c of candidates) {
      if (recovered >= CFG.maxActionsPerRun) {
        console.warn(`[Pay2New-FalseRefundDiscovery] per-run action cap (${CFG.maxActionsPerRun}) reached; deferring the rest`)
        break
      }
      const ref = c.reference_id as string
      const amount = Number(c.debit)
      if (!ref || !(amount > 0)) continue
      if (amount > CFG.maxAmount) {
        console.warn(`[Pay2New-FalseRefundDiscovery] ${ref} ₹${amount} exceeds maxAmount — skipping (manual)`)
        continue
      }

      // Must have a refund to reverse, and must not already be clawed back.
      const { data: refundRow } = await supabase
        .from('partner_wallet_ledger')
        .select('id').eq('partner_id', c.partner_id).eq('reference_id', `REFUND_${ref}`).limit(1).maybeSingle()
      if (!refundRow) continue
      const { data: already } = await supabase
        .from('partner_wallet_ledger')
        .select('id').eq('partner_id', c.partner_id).eq('reference_id', `CLAWBACK_${ref}`).limit(1).maybeSingle()
      if (already) continue

      // FRESH vendor re-verify — only a definitive SUCCESS justifies a clawback.
      let st
      try {
        st = await pay2newCheckStatus({ request_id: ref })
      } catch (e: any) {
        console.error(`[Pay2New-FalseRefundDiscovery] status error ${ref}:`, e?.message)
        continue
      } finally {
        await sleep(CFG.spacingMs)
      }
      checked++
      if (!st.success || st.status !== 'SUCCESS') continue // refund stands; re-check later

      // ---- CONFIRMED FALSE REFUND: we refunded but the vendor SUCCEEDED ----
      console.warn(
        `[Pay2New-FalseRefundDiscovery] FALSE REFUND ${ref} ₹${amount} partner=${c.partner_id} order=${st.order_id || '-'}`
      )
      Sentry.captureMessage(
        `Pay2New false refund discovered: ${ref} ₹${amount} partner=${c.partner_id} order=${st.order_id || 'N/A'}`,
        'warning'
      )

      if (CFG.dryRun) {
        console.log(`[Pay2New-FalseRefundDiscovery] DRY-RUN would claw back ₹${amount} ref=${ref} partner=${c.partner_id}`)
        continue
      }

      // Balance available for the EXACT amount? (never force a wallet negative in
      // an unattended loop — short balances are queued for the recovery cron.)
      const { data: wallet } = await supabase
        .from('partner_wallets').select('balance, is_frozen').eq('partner_id', c.partner_id).maybeSingle()
      const bal = Number(wallet?.balance || 0)
      if (wallet?.is_frozen || bal < amount) {
        // Hand off to the standing recovery cron (idempotent tag).
        await supabase
          .from('partner_wallet_ledger')
          .update({
            description: `${c.description || ''} | FalseRefundConfirmed(order:${st.order_id || 'N/A'} ref:${st.operator_reference || 'N/A'}) RecoveryPending`,
          })
          .eq('id', c.id)
          .not('description', 'ilike', '%FalseRefundConfirmed%')
        queued++
        console.log(`[Pay2New-FalseRefundDiscovery] queued ${ref} for standing recovery (${wallet?.is_frozen ? 'frozen' : `bal ₹${bal} < ₹${amount}`})`)
        continue
      }

      // Idempotent clawback (reverse the wrong refund).
      const { error: rpcErr } = await supabase.rpc('debit_partner_wallet', {
        p_partner_id: c.partner_id,
        p_amount: amount,
        p_payout_transaction_id: null,
        p_description: `BBPS-2 clawback of false refund — vendor SUCCESS | orig ${ref}`,
        p_reference_id: `CLAWBACK_${ref}`,
        p_service_type: 'pay2new',
      })
      if (rpcErr) {
        if (/insufficient/i.test(rpcErr.message || '')) {
          // Raced the balance — queue for the recovery cron.
          await supabase
            .from('partner_wallet_ledger')
            .update({
              description: `${c.description || ''} | FalseRefundConfirmed(order:${st.order_id || 'N/A'} ref:${st.operator_reference || 'N/A'}) RecoveryPending`,
            })
            .eq('id', c.id)
            .not('description', 'ilike', '%FalseRefundConfirmed%')
          queued++
          continue
        }
        if (/duplicate/i.test(rpcErr.message || '')) continue // already clawed back
        console.error(`[Pay2New-FalseRefundDiscovery] CRITICAL clawback failed ${ref}:`, rpcErr.message)
        Sentry.captureException(new Error(`Pay2New false-refund clawback failed ${ref}: ${rpcErr.message}`))
        continue
      }

      // Annotate the original debit SUCCESS so ledger-status resolves it correctly.
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
      console.log(`[Pay2New-FalseRefundDiscovery] ✓ recovered ₹${amount} ref=${ref} via CLAWBACK_${ref}`)

      // Push SUCCESS so the partner flips their record refunded -> success.
      const { amount: amt, charge } = parseAmounts(c.description)
      emitWebhook(supabase, c.partner_id, {
        billFetchRef: (c as any).bill_fetch_ref ?? null,
        requestId: ref,
        orderId: st.order_id || null,
        status: 'SUCCESS',
        amount: amt,
        charge,
        operatorReference: st.operator_reference || null,
      })
    }
  } catch (e: any) {
    console.error('[Pay2New-FalseRefundDiscovery] run error:', e?.message)
    Sentry.captureException(e)
  } finally {
    state.isRunning = false
    console.log(
      `[Pay2New-FalseRefundDiscovery] done: checked=${checked} recovered=${recovered} (₹${recoveredAmount}) ` +
        `queued=${queued}${CFG.dryRun ? ' (DRY-RUN)' : ''} in ${Date.now() - startedAt}ms`
    )
  }
}

export async function initPay2NewFalseRefundDiscoveryCron(): Promise<void> {
  if (!CFG.enabled) {
    console.log('[Pay2New-FalseRefundDiscovery] disabled (PAY2NEW_FALSE_REFUND_DISCOVERY_ENABLED=false); not scheduling')
    return
  }
  if (state.task) {
    state.task.stop()
    state.task = null
  }
  state.task = cron.schedule(CRON_EXPRESSION, runCheck, { timezone: 'Asia/Kolkata' })
  console.log(
    `[Pay2New-FalseRefundDiscovery] scheduled (${CRON_EXPRESSION}) dryRun=${CFG.dryRun} ` +
      `lookback=${CFG.lookbackDays}d batch=${CFG.batch} maxAmount=₹${CFG.maxAmount} maxActions/run=${CFG.maxActionsPerRun}`
  )
}

export function stopPay2NewFalseRefundDiscoveryCron(): void {
  if (state.task) {
    state.task.stop()
    state.task = null
  }
}
