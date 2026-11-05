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
 *   - ALL ROLES: the partner-API flow (partner_wallet_ledger) AND the in-app
 *     flow (pay2new_transactions — in-app partners + retailers) are both scanned.
 *     In-app detections always route to manual approval (the cron never moves
 *     in-app money); the admin tab + standing recovery cron handle recovery.
 *
 * All knobs are env-driven; see CFG below.
 */

import cron, { ScheduledTask } from 'node-cron'
import * as Sentry from '@sentry/nextjs'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { checkStatusWithLog } from '@/lib/pay2new/status-log'
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
  // MANUAL APPROVAL (default): a confirmed false refund is only DETECTED + tagged
  // `AwaitingApproval` for a human to approve on the Clawback Approval tab — this
  // cron never moves money. Set PAY2NEW_FALSE_REFUND_MANUAL_APPROVAL=false to let
  // it auto-claw-back within the caps (legacy behaviour).
  manualApproval: process.env.PAY2NEW_FALSE_REFUND_MANUAL_APPROVAL !== 'false',
  // Settle delay: only judge refunds at least this old, so the vendor state is
  // terminal before we verify (avoids churn on still-settling payments).
  minAgeHours: posInt(process.env.PAY2NEW_FALSE_REFUND_MIN_AGE_HOURS, 12),
  // Re-verify window: a refund confirmed CORRECT is skipped until it is this many
  // days old again, then re-checked once (guards against a late vendor flip).
  reverifyDays: posInt(process.env.PAY2NEW_FALSE_REFUND_REVERIFY_DAYS, 30),
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
  let flagged = 0          // detected false refunds tagged AwaitingApproval (manual mode)
  let flaggedAmount = 0
  let verifiedCorrect = 0  // refunds confirmed CORRECT and watermarked (skipped next time)

  try {
    const supabase = getSupabaseAdmin()
    const minCreatedAt = new Date(Date.now() - CFG.lookbackDays * 864e5).toISOString()
    // Settle delay — ignore refunds younger than minAgeHours (vendor not terminal yet).
    const maxCreatedAt = new Date(Date.now() - CFG.minAgeHours * 3_600_000).toISOString()
    // Re-verify threshold — a row verified-correct before this instant is eligible
    // for one more check (guards a late vendor flip); newer verifications are skipped.
    const reverifyBefore = new Date(Date.now() - CFG.reverifyDays * 864e5).toISOString()

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
        .lt('created_at', maxCreatedAt)
        // INCREMENTAL: skip rows already vendor-verified recently (self-draining).
        .or(`refund_verified_at.is.null,refund_verified_at.lt.${reverifyBefore}`)
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
        st = await checkStatusWithLog(supabase, { request_id: ref }, 'false_refund_cron')
      } catch (e: any) {
        console.error(`[Pay2New-FalseRefundDiscovery] status error ${ref}:`, e?.message)
        continue
      } finally {
        await sleep(CFG.spacingMs)
      }
      checked++

      // Only a DEFINITIVE vendor verdict advances the audit. PENDING / unreachable
      // leaves the row un-watermarked so it is re-checked next cycle.
      if (!st.success || st.status === 'PENDING') continue
      const vendorStatus = st.notFound ? 'NOT_FOUND' : st.status

      // ---- CORRECT REFUND: vendor really did not charge (FAILED/REFUNDED/NOT_FOUND).
      // Watermark it so the incremental scan skips it until the re-verify window. ----
      if (st.status !== 'SUCCESS') {
        await supabase
          .from('partner_wallet_ledger')
          .update({ refund_verified_at: new Date().toISOString(), refund_verified_status: vendorStatus })
          .eq('id', c.id)
        verifiedCorrect++
        continue
      }

      // ---- CONFIRMED FALSE REFUND: we refunded but the vendor SUCCEEDED ----
      console.warn(
        `[Pay2New-FalseRefundDiscovery] FALSE REFUND ${ref} ₹${amount} partner=${c.partner_id} order=${st.order_id || '-'}`
      )
      Sentry.captureMessage(
        `Pay2New false refund discovered: ${ref} ₹${amount} partner=${c.partner_id} order=${st.order_id || 'N/A'}`,
        'warning'
      )

      // MANUAL APPROVAL (default): never move money here. Watermark + tag the row
      // AwaitingApproval so it surfaces on the admin Clawback Approval tab; the
      // standing recovery cron ignores AwaitingApproval until a human approves it.
      if (CFG.manualApproval) {
        await supabase
          .from('partner_wallet_ledger')
          .update({
            refund_verified_at: new Date().toISOString(),
            refund_verified_status: 'SUCCESS',
            description: `${c.description || ''} | FalseRefundConfirmed(order:${st.order_id || 'N/A'} ref:${st.operator_reference || 'N/A'}) AwaitingApproval`,
          })
          .eq('id', c.id)
          .not('description', 'ilike', '%FalseRefundConfirmed%')
        flagged++
        flaggedAmount += amount
        console.log(`[Pay2New-FalseRefundDiscovery] flagged ${ref} ₹${amount} for approval (AwaitingApproval)`)
        continue
      }

      // ---- AUTO mode (PAY2NEW_FALSE_REFUND_MANUAL_APPROVAL=false) ----
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

    // ════════════════════════════════════════════════════════════════════════
    // DOMAIN 2 — IN-APP FLOW (ALL ROLES: in-app partner + retailer).
    // Canonical record is pay2new_transactions; a direct refund marks THAT row
    // 'refunded' without flipping the ledger debit to 'failed', so the partner
    // ledger scan above never sees it. Same incremental watermark policy. In-app
    // detection ALWAYS routes to manual approval (money never moves here) — the
    // admin Clawback Approval tab + the standing recovery cron handle recovery.
    // ════════════════════════════════════════════════════════════════════════
    const buildDirectQuery = () =>
      supabase
        .from('pay2new_transactions')
        .select('id, user_id, user_role, request_id, total_debit, amount, charge, order_id, created_at')
        .eq('status', 'refunded')
        .ilike('request_id', 'SDS%')
        .gt('created_at', minCreatedAt)
        .lt('created_at', maxCreatedAt)
        .or(`refund_verified_at.is.null,refund_verified_at.lt.${reverifyBefore}`)
        .is('clawback_state', null)

    const dHalf = Math.max(1, Math.floor(CFG.batch / 2))
    const [dRecent, dOld] = await Promise.all([
      buildDirectQuery().order('created_at', { ascending: false }).limit(dHalf),
      buildDirectQuery().order('created_at', { ascending: true }).limit(CFG.batch - dHalf),
    ])
    const dSeen = new Set<string>()
    const dCandidates = [...(dRecent.data || []), ...(dOld.data || [])].filter((r: any) => {
      if (dSeen.has(r.id)) return false
      dSeen.add(r.id); return true
    })
    if (dRecent.error || dOld.error) {
      console.error('[Pay2New-FalseRefundDiscovery] in-app candidate query error:', (dRecent.error || dOld.error)?.message)
    } else if (dCandidates.length) {
      console.log(`[Pay2New-FalseRefundDiscovery] ${dCandidates.length} in-app candidate(s) [MANUAL]`)
      for (const c of dCandidates as any[]) {
        const ref = c.request_id as string
        const amount = Number(c.total_debit) || (Number(c.amount || 0) + Number(c.charge || 0))
        if (!ref || !(amount > 0)) continue
        if (amount > CFG.maxAmount) {
          console.warn(`[Pay2New-FalseRefundDiscovery] (in-app) ${ref} ₹${amount} exceeds maxAmount — skipping (manual)`)
          continue
        }
        const isPartner = c.user_role === 'partner'
        const table = isPartner ? 'partner_wallet_ledger' : 'wallet_ledger'
        const idCol = isPartner ? 'partner_id' : 'retailer_id'

        // Must have a REFUND_ to reverse, and must not already be clawed back.
        const { data: refundRow } = await supabase
          .from(table).select('id').eq(idCol, c.user_id).eq('reference_id', `REFUND_${ref}`).limit(1).maybeSingle()
        if (!refundRow) continue
        const { data: already } = await supabase
          .from(table).select('id').eq(idCol, c.user_id).eq('reference_id', `CLAWBACK_${ref}`).limit(1).maybeSingle()
        if (already) {
          // Recovered out-of-band already — reflect reality so the queue is correct.
          await supabase.from('pay2new_transactions')
            .update({ refund_verified_at: new Date().toISOString(), refund_verified_status: 'SUCCESS', clawback_state: 'recovered' })
            .eq('id', c.id)
          continue
        }

        let dst
        try {
          dst = await checkStatusWithLog(supabase, { request_id: ref }, 'false_refund_cron')
        } catch (e: any) {
          console.error(`[Pay2New-FalseRefundDiscovery] (in-app) status error ${ref}:`, e?.message)
          continue
        } finally {
          await sleep(CFG.spacingMs)
        }
        checked++
        if (!dst.success || dst.status === 'PENDING') continue
        const dVendorStatus = dst.notFound ? 'NOT_FOUND' : dst.status

        // CORRECT refund — watermark and skip until the re-verify window.
        if (dst.status !== 'SUCCESS') {
          await supabase.from('pay2new_transactions')
            .update({ refund_verified_at: new Date().toISOString(), refund_verified_status: dVendorStatus })
            .eq('id', c.id)
          verifiedCorrect++
          continue
        }

        // CONFIRMED FALSE REFUND (in-app). Detection only — flag for human approval.
        console.warn(`[Pay2New-FalseRefundDiscovery] FALSE REFUND (in-app ${c.user_role}) ${ref} ₹${amount} user=${c.user_id} order=${dst.order_id || '-'}`)
        Sentry.captureMessage(`Pay2New false refund discovered (in-app ${c.user_role}): ${ref} ₹${amount} user=${c.user_id} order=${dst.order_id || 'N/A'}`, 'warning')
        await supabase.from('pay2new_transactions')
          .update({
            refund_verified_at: new Date().toISOString(),
            refund_verified_status: 'SUCCESS',
            clawback_state: 'awaiting_approval',
            clawback_order_id: dst.order_id || null,
            clawback_operator_ref: dst.operator_reference || null,
          })
          .eq('id', c.id)
        flagged++
        flaggedAmount += amount
      }
    }
  } catch (e: any) {
    console.error('[Pay2New-FalseRefundDiscovery] run error:', e?.message)
    Sentry.captureException(e)
  } finally {
    state.isRunning = false
    console.log(
      `[Pay2New-FalseRefundDiscovery] done: checked=${checked} verifiedCorrect=${verifiedCorrect} ` +
        `flaggedForApproval=${flagged} (₹${flaggedAmount}) recovered=${recovered} (₹${recoveredAmount}) ` +
        `queued=${queued}${CFG.manualApproval ? ' [MANUAL]' : CFG.dryRun ? ' (DRY-RUN)' : ''} in ${Date.now() - startedAt}ms`
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
    `[Pay2New-FalseRefundDiscovery] scheduled (${CRON_EXPRESSION}) mode=${CFG.manualApproval ? 'MANUAL-APPROVAL' : CFG.dryRun ? 'AUTO(DRY-RUN)' : 'AUTO'} ` +
      `minAge=${CFG.minAgeHours}h reverify=${CFG.reverifyDays}d lookback=${CFG.lookbackDays}d batch=${CFG.batch} ` +
      `maxAmount=₹${CFG.maxAmount} maxActions/run=${CFG.maxActionsPerRun}`
  )
}

export function stopPay2NewFalseRefundDiscoveryCron(): void {
  if (state.task) {
    state.task.stop()
    state.task = null
  }
}
