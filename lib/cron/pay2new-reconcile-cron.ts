/**
 * Pay2New (BBPS-2 Credit Card) stuck-debit reconciliation cron.
 *
 * WHY: The partner pay route debits the wallet BEFORE calling Pay2New. If that
 * call hangs/times out or the process restarts mid-request, the success- and
 * failure-handlers never run, leaving a debit with no order and no refund — the
 * partner is charged but the bill is never paid (see incident SDS1785484676100).
 *
 * WHAT: Every few minutes, look at pay2new debits that have neither a recorded
 * order nor a refund, ask Pay2New for the authoritative status, and:
 *   - SUCCESS  -> annotate the ledger row (OrderID) so we never re-check it.
 *   - FAILED / REFUNDED (definitive order-level verdict) -> refund the partner
 *     wallet (idempotent, keyed on REFUND_<request_id>) and mark the debit failed.
 *   - "No Transaction Found" -> INCONCLUSIVE: flag for admin review, never refund.
 *   - PENDING / provider unreachable -> hold; re-check next cycle (no time limit).
 *
 * POLICY (money movement — never false-refund a paid bill):
 *   - The ONLY age gate is a 15-min FLOOR (MIN_AGE_MIN). There is NO upper bound:
 *     a confirmed FAILED debit is refunded no matter how old, and a PENDING one
 *     is held forever until the provider gives a terminal status. Holding funds
 *     indefinitely is preferred over ever refunding a successful payment.
 *   - NEVER refunds on a local signal alone. Only a definitive provider order
 *     verdict (status failed / reversed) triggers a refund. "No transaction
 *     found" is inconclusive (provider index can lag a real charge) and is
 *     flagged for admin, never auto-refunded. Anything else stays PENDING.
 *   - DRY-RUN by default (PAY2NEW_RECON_DRY_RUN !== 'false'): logs intended
 *     refunds without moving money. Non-financial success-annotation still runs
 *     so the working set drains and you can watch it operate safely.
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
import { reverseServiceCommission } from '@/lib/commission/distribute-service-commission'
import { deliverPartnerCallbackByPartnerId } from '@/lib/partner-webhook/deliver'
import { buildPay2NewStatusPayload, type Pay2NewTerminalStatus } from '@/lib/partner-webhook/pay2new-payload'

/** Parse "₹<bill> + ₹<charge> charge" out of a ledger description. */
function parseAmounts(desc: string | null): { amount: number | null; charge: number | null } {
  const m = desc?.match(/₹([\d.]+)\s*\+\s*₹([\d.]+)\s*charge/)
  return { amount: m ? parseFloat(m[1]) : null, charge: m ? parseFloat(m[2]) : null }
}

/**
 * Push a terminal pay state to the owning partner (signed, retried, logged).
 * Fire-and-forget: never throws, never blocks the recon loop. This is the
 * self-heal path for the exact incident — a bill/pay whose HTTP reply was lost
 * or whose handler died mid-request still reaches the partner here.
 */
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
    logPrefix: 'Pay2New-Recon Callback',
  }).catch(() => {})
}

/**
 * Flag a stuck partner debit for ADMIN manual review (money stays held, never
 * auto-refunded). Used for an inconclusive "no transaction found" and for a
 * payment aged past the auto-act window. Annotates the ledger row so the admin
 * reversals view can surface it and the cron stops re-checking it.
 */
async function flagReview(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  row: { id: string; partner_id: string; reference_id: string; description: string | null; debit?: number | null },
  reason: string
): Promise<void> {
  try {
    await supabase
      .from('partner_wallet_ledger')
      .update({ description: `${row.description || ''} | ReviewRequired(${reason})` })
      .eq('id', row.id)
    Sentry.captureMessage(
      `Pay2New held payment needs admin review: ${row.reference_id} ₹${row.debit ?? '?'} partner=${row.partner_id} (${reason})`,
      'warning'
    )
    console.warn(`[Pay2New-Recon] REVIEW flagged ref=${row.reference_id} (${reason}) — held, admin must resolve`)
  } catch (e: any) {
    console.error(`[Pay2New-Recon] failed to flag review ${row.reference_id}:`, e?.message)
  }
}

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
  // Minimum hold: don't auto-act on txns younger than this (may still be
  // completing at the provider). This is a FLOOR, not a window — there is NO
  // upper age bound. A confirmed-FAILED payment must be refundable for as long
  // as it takes us to confirm it; a PENDING one stays held indefinitely until
  // the provider gives a terminal status. (Policy: never false-refund a paid
  // bill — holding funds forever beats refunding a success.)
  minAgeMin: posInt(process.env.PAY2NEW_RECON_MIN_AGE_MIN, 15),
  // Candidates inspected per run (split half newest-first, half oldest-first).
  batch: posInt(process.env.PAY2NEW_RECON_BATCH, 50),
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
    // Only the 15-min FLOOR applies — no upper age bound. Anything older than the
    // floor is fair game so a confirmed failure can be refunded no matter how old.
    const maxCreatedAt = new Date(nowMs - CFG.minAgeMin * 60_000).toISOString()

    // Candidate = a pay2new DEBIT, not already marked failed, with no order
    // recorded (no "OrderID:"/verified marker) and past the 15-min floor. The
    // per-row refund check below confirms there is no existing refund.
    const buildCandidateQuery = () =>
      supabase
        .from('partner_wallet_ledger')
        .select('id, partner_id, reference_id, debit, description, created_at, bill_fetch_ref')
        .eq('service_type', 'pay2new')
        .eq('transaction_type', 'DEBIT')
        // Only real Pay2New API payments (request_id = "SDS<ts>"). Excludes manual
        // corrections/adjustments (e.g. CORRECTION_DEBIT_MANUAL) that share the
        // pay2new service_type but were never sent to the provider.
        .ilike('reference_id', 'SDS%')
        .neq('status', 'failed')
        .lt('created_at', maxCreatedAt)
        .not('description', 'ilike', '%OrderID:%')
        .not('description', 'ilike', '%ReconVerified%')
        // Already escalated to admin (not-found) — stop re-processing.
        .not('description', 'ilike', '%ReviewRequired%')

    // Process NEWEST-first AND OLDEST-first in the same tick so freshly-stuck
    // (customer-visible) payments resolve promptly while the historical backlog
    // still drains — neither can starve the other. (Previously oldest-only, which
    // let a large backlog delay today's payments by hours.)
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

      // Belt-and-suspenders idempotency: if a refund already exists, this debit
      // is resolved — mark it failed so it drops out of the candidate set (no
      // more re-scanning on every run) and move on without a provider call.
      const { data: existingRefund } = await supabase
        .from('partner_wallet_ledger')
        .select('id')
        .eq('partner_id', c.partner_id)
        .eq('reference_id', `REFUND_${ref}`)
        .limit(1)
        .maybeSingle()
      if (existingRefund) {
        await supabase
          .from('partner_wallet_ledger')
          .update({ status: 'failed' })
          .eq('id', c.id)
        continue
      }

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
        // This is the lost-response case: the payment succeeded but the pay
        // handler never recorded the order (crash / dropped reply). Push the
        // SUCCESS to the partner so they finalize without a human.
        const { amount, charge } = parseAmounts(c.description)
        emitWebhook(supabase, c.partner_id, {
          billFetchRef: (c as any).bill_fetch_ref ?? null,
          requestId: ref,
          orderId: res.order_id || null,
          status: 'SUCCESS',
          amount,
          charge,
          operatorReference: res.operator_reference || null,
        })
        continue
      }

      // "No transaction found" is INCONCLUSIVE (the provider's index can lag a
      // real charge) — per policy we NEVER auto-refund it. Flag for admin manual
      // review and move on; the money stays held.
      if (res.notFound) {
        await flagReview(supabase, c, 'not_found')
        continue
      }

      // Still processing or unknown -> wait, do not refund.
      if (res.status !== 'FAILED' && res.status !== 'REFUNDED') continue

      // ---- Definitive order-level FAILED/REFUNDED: partner is owed a refund ----
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
      // Mark the debit row failed so it drops out of the candidate set (no more
      // re-scanning on every run) and the ledger status reflects reality.
      await supabase
        .from('partner_wallet_ledger')
        .update({ status: 'failed' })
        .eq('id', c.id)
      // Unwind any distributed commission/margin so a reversal nets to 0 margin
      // (idempotent; a no-op when nothing was distributed for this txn).
      await reverseServiceCommission({ supabase, service: 'pay2new', refPrefix: 'P2N', refKey: ref })
      console.log(`[Pay2New-Recon] REFUNDED ₹${amount} ref=${ref} partner=${c.partner_id} (${reason})`)
      // Push the terminal REFUNDED state so the partner releases the held txn.
      const amt = parseAmounts(c.description)
      emitWebhook(supabase, c.partner_id, {
        billFetchRef: (c as any).bill_fetch_ref ?? null,
        requestId: ref,
        orderId: null,
        status: 'REFUNDED',
        amount: amt.amount,
        charge: amt.charge,
        operatorReference: null,
        message: reason,
      })
    }

    // NOTE: There is intentionally NO separate "aged / over-window" escalation.
    // The 15-min floor is the only age gate — the main loop above resolves a
    // confirmed-FAILED debit no matter how old it is (refund), confirms SUCCESS
    // (annotate), holds PENDING, and flags only the genuinely INCONCLUSIVE
    // "no transaction found" case for admin review. Nothing can silently age out.
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
      `minAge=${CFG.minAgeMin}m (no max) batch=${CFG.batch} ` +
      `maxAmount=₹${CFG.maxAmount} maxRefunds/run=${CFG.maxRefundsPerRun}`
  )
}

export function stopPay2NewReconcileCron(): void {
  if (state.task) {
    state.task.stop()
    state.task = null
  }
}
