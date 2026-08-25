import type { SupabaseClient } from '@supabase/supabase-js'
import { checkTransactionStatus } from '@/services/shadval-pay'
import { sendSettlementCallback } from '@/lib/settlement-callback'
import { refundShadvalSettlement, isGenuineProviderSuccess, computeShadvalRefundAmount } from '@/lib/settlement-2/shadval-refund'
import { raiseSettlementAlert, resolveSettlementAlerts } from '@/lib/settlement-alerts'

/**
 * Shared reconciliation for partner Settlement-2 (shadval) PENDING transfers.
 *
 * SINGLE SOURCE OF TRUTH — called by BOTH the manual/admin
 * `/api/partner/settlement/check-pending` route AND the automatic
 * `partner-settlement-check` cron. Keeping one implementation is deliberate:
 * the exactly-once refund + anti-double-credit logic must never diverge between
 * the manual and automatic paths.
 *
 * NO-DOUBLE-CREDIT GUARANTEES:
 *   1. Every PENDING→terminal transition is claimed atomically
 *      (`.eq('status','PENDING')`), so two overlapping runs can never both
 *      process the same row.
 *   2. Refunds funnel through `refundShadvalSettlement`, which is idempotent
 *      (one deterministic `REFUND_<ref>` credit) and carries the anti-loss
 *      guard: it re-checks the provider and REFUSES to refund a payout that
 *      genuinely succeeded (UTR present) — reconciling to SUCCESS instead.
 *   3. Success never credits anything (money was already debited at transfer);
 *      it only records the UTR and fires the partner callback.
 *   4. TIMEOUT SAFETY (Option C, default): a still-PENDING payout is NEVER
 *      auto-failed/refunded on timeout. It is HELD as PENDING until the provider
 *      confirms failure/reversal (which refunds it) or an admin refunds it
 *      manually after confirming the reversal on Shadval. This is the guard
 *      against refunding the user before Shadval has actually reversed the money.
 */

/** Authoritative account-type check — partners table is the source of truth. */
async function isPartnerAccount(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data } = await supabase.from('partners').select('id').eq('id', id).maybeSingle()
  return !!data
}

export interface ResolvePendingOptions {
  /** Only touch transactions older than this many minutes. Default 1. */
  staleMinutes?: number
  /** Age (minutes) after which a still-PENDING transaction is either held for
   *  review or (only if refundOnHardTimeout) force-failed + refunded. Default 60. */
  hardTimeoutMinutes?: number
  /**
   * SAFETY (Option C). When false (default) a transaction the provider still
   * reports as PENDING is NEVER auto-failed/auto-refunded on timeout — it is
   * HELD as PENDING (money stays debited) until either the provider confirms a
   * failure/reversal (poll path refunds it) or an admin refunds it manually via
   * /admin/reversals after confirming the reversal on the Shadval side. This
   * prevents refunding the user before Shadval has actually reversed the money,
   * which would cause a double-money loss if the payout later settles.
   */
  refundOnHardTimeout?: boolean
  /**
   * Age (minutes) at which a still-PENDING (held) transaction raises an admin
   * alert so it is never silently stuck. Defaults to hardTimeoutMinutes.
   */
  holdAlertMinutes?: number
  /** Max rows per sweep. Default 50. */
  limit?: number
}

export interface ResolvePendingResult {
  checked: number
  resolved: number
  refunded: number
  stillPending: number
  /** Transactions past the hard timeout that were HELD (not refunded) — need review. */
  timeoutHeld: number
  results: Array<{ id: string; ref: string; previous_status: string; new_status: string; action: string }>
}

export async function resolvePendingPartnerSettlements(
  supabase: SupabaseClient,
  options: ResolvePendingOptions = {}
): Promise<ResolvePendingResult> {
  const staleMinutes = options.staleMinutes ?? 1
  const hardTimeoutMinutes = options.hardTimeoutMinutes ?? 60
  const refundOnHardTimeout = options.refundOnHardTimeout ?? false
  const holdAlertMinutes = options.holdAlertMinutes ?? hardTimeoutMinutes
  const limit = options.limit ?? 50

  const staleThreshold = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString()
  const hardTimeoutThreshold = new Date(Date.now() - hardTimeoutMinutes * 60 * 1000).toISOString()

  const { data: pendingTxs, error: fetchErr } = await supabase
    .from('shadval_settlement')
    .select('id, retailer_id, reference_id, order_id, amount, charges, total_debit, actual_wallet_debit, mode, status, account_number, ifsc_code, account_holder_name, status_message, provider_timestamp, utr, created_at')
    .eq('status', 'PENDING')
    .lt('created_at', staleThreshold)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (fetchErr) {
    throw new Error(`Failed to fetch pending transactions: ${fetchErr.message}`)
  }

  const result: ResolvePendingResult = { checked: 0, resolved: 0, refunded: 0, stillPending: 0, timeoutHeld: 0, results: [] }

  if (!pendingTxs || pendingTxs.length === 0) return result

  for (const tx of pendingTxs) {
    result.checked++

    // Try checking status with provider if we have a reference_id
    if (tx.reference_id) {
      try {
        const statusResult = await checkTransactionStatus({ reference_id: tx.reference_id })

        if (statusResult.status === 'SUCCESS' && statusResult.data) {
          const txnStatus = statusResult.data.txn_status?.toLowerCase() || ''
          // Genuine success requires a UTR (money left the bank). Never treat a
          // bare "success" string as terminal success without one.
          const isSuccess = isGenuineProviderSuccess(statusResult)
          const isFailed = !isSuccess && (txnStatus.includes('fail') || txnStatus.includes('revers') || txnStatus.includes('refund'))

          if (isSuccess || isFailed) {
            const newStatus = isSuccess ? 'SUCCESS' : 'FAILED'

            // Atomically claim the transition — prevents two runs (cron +
            // manual, or two cron ticks) from both processing this row.
            const { data: claimed } = await supabase
              .from('shadval_settlement')
              .update({
                status: newStatus,
                utr: statusResult.data.utr || tx.utr || null,
                order_id: statusResult.data.order_id || tx.order_id || null,
                internal_ref_id: statusResult.data.internal_ref_id || null,
                status_message: statusResult.data.status_message || statusResult.data.txn_status || null,
                provider_timestamp: statusResult.data.timestamp || null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', tx.id)
              .eq('status', 'PENDING')
              .select('id')

            if (!claimed || claimed.length === 0) {
              result.results.push({ id: tx.id, ref: tx.reference_id, previous_status: 'PENDING', new_status: 'PENDING', action: 'already_claimed' })
              continue
            }

            // The transaction is now terminal — clear any open HOLD alert.
            resolveSettlementAlerts(supabase, [tx.id], 'auto-resolved-terminal').catch(() => {})

            if (isFailed) {
              // Route to the correct wallet (partner vs retailer) via the shared
              // exactly-once refund helper.
              const refund = await refundShadvalSettlement(supabase, tx, { note: 'check-pending auto' })
              if (refund.blockedProviderSuccess) {
                // Payout actually succeeded — undo the FAILED flip. No refund, no loss.
                console.warn(`[Settlement Resolve] Refund BLOCKED — provider confirms success (UTR ${refund.providerUtr}) for ${tx.id}. Reconciling to SUCCESS.`)
                await supabase
                  .from('shadval_settlement')
                  .update({
                    status: 'SUCCESS',
                    utr: refund.providerUtr || statusResult.data.utr || tx.utr || null,
                    status_message: `${statusResult.data.status_message || statusResult.data.txn_status || 'SUCCESS'} [Reconciled SUCCESS — refund blocked, payout confirmed]`,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', tx.id)
                result.resolved++
                result.results.push({ id: tx.id, ref: tx.reference_id, previous_status: 'PENDING', new_status: 'SUCCESS', action: 'reconciled_success_refund_blocked' })
                continue
              }
              if (refund.critical) {
                console.error(`[Settlement Resolve] CRITICAL refund failed for ${tx.id}:`, refund.error)
                await supabase
                  .from('shadval_settlement')
                  .update({
                    status_message: `${statusResult.data.status_message || statusResult.data.txn_status || 'FAILED'} [CRITICAL: REFUND_FAILED - Manual review required] (${refund.error})`,
                  })
                  .eq('id', tx.id)
              } else if (!refund.alreadyRefunded) {
                result.refunded++
              }
            }

            // Send callback to partner
            const updatedTx = {
              ...tx,
              status: newStatus,
              utr: statusResult.data.utr || tx.utr,
              order_id: statusResult.data.order_id || tx.order_id,
              status_message: statusResult.data.status_message || statusResult.data.txn_status,
              provider_timestamp: statusResult.data.timestamp,
            }
            sendSettlementCallback(tx.retailer_id, updatedTx).catch(() => {})

            result.resolved++
            result.results.push({ id: tx.id, ref: tx.reference_id, previous_status: 'PENDING', new_status: newStatus, action: isFailed ? 'resolved_failed_refunded' : 'resolved_success' })
            continue
          }
        }
      } catch (err: any) {
        console.error(`[Settlement Resolve] Status check error for ${tx.id}:`, err?.message || err)
      }
    }

    // Hard timeout handling for transactions older than hardTimeoutMinutes.
    if (tx.created_at < hardTimeoutThreshold) {
      const txAgeMin = Math.round((Date.now() - new Date(tx.created_at).getTime()) / 60000)

      // SAFETY (Option C) — default path: DO NOT auto-fail/auto-refund a payout
      // the provider still reports as PENDING. Refunding before Shadval has
      // actually reversed the money risks a double-money loss if the payout
      // later settles. Hold the row as PENDING (money stays debited) and flag it
      // for provider-confirmed resolution or manual admin refund.
      if (!refundOnHardTimeout) {
        const holdMarker = '[HOLD: awaiting provider reversal — no auto-refund]'
        const alreadyFlagged = (tx.status_message || '').includes(holdMarker)
        if (!alreadyFlagged) {
          await supabase
            .from('shadval_settlement')
            .update({
              status_message: `Pending ${txAgeMin} min — ${holdMarker}`,
              updated_at: new Date().toISOString(),
            })
            .eq('id', tx.id)
            .eq('status', 'PENDING')
        }

        // Raise an admin alert so a held transaction is never silently stuck.
        // Dedup is handled by settlement_alerts (one open alert per txn_id).
        if (txAgeMin >= holdAlertMinutes) {
          const isPartner = await isPartnerAccount(supabase, tx.retailer_id)
          const heldAmount = computeShadvalRefundAmount(tx)
          raiseSettlementAlert(supabase, {
            alertType: 'SETTLEMENT2_HOLD_PENDING',
            retailerId: isPartner ? undefined : tx.retailer_id,
            partnerId: isPartner ? tx.retailer_id : undefined,
            txnId: tx.id,
            amount: heldAmount,
            reason: `Settlement-2 held ${txAgeMin} min, still PENDING at provider — ${tx.reference_id} → ${tx.account_holder_name || ''} ${tx.account_number || ''} (${tx.mode || ''}). Awaiting provider reversal; verify on Shadval.`,
            details: {
              reference_id: tx.reference_id,
              order_id: tx.order_id,
              account_number: tx.account_number,
              ifsc_code: tx.ifsc_code,
              account_holder_name: tx.account_holder_name,
              mode: tx.mode,
              age_minutes: txAgeMin,
              created_at: tx.created_at,
            },
          }).catch(() => {})
        }

        result.timeoutHeld++
        result.stillPending++
        result.results.push({ id: tx.id, ref: tx.reference_id, previous_status: 'PENDING', new_status: 'PENDING', action: `timeout_hold_no_refund_${txAgeMin}min` })
        continue
      }

      // LEGACY behaviour — only when refundOnHardTimeout is explicitly enabled:
      // force-fail + refund (still protected by the anti-loss provider re-check).
      const { data: claimed } = await supabase
        .from('shadval_settlement')
        .update({
          status: 'FAILED',
          status_message: `Auto-failed: No resolution after ${txAgeMin} minutes`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', tx.id)
        .eq('status', 'PENDING')
        .select('id')

      if (claimed && claimed.length > 0) {
        // Terminal now — clear any open HOLD alert.
        resolveSettlementAlerts(supabase, [tx.id], 'auto-resolved-terminal').catch(() => {})
        // Unified reference (REFUND_<ref>) — NOT REFUND_TIMEOUT_ — so this can
        // never double-credit on top of a status-poll/verify refund. The helper
        // also treats any legacy REFUND_TIMEOUT_ entry as already refunded.
        //
        // The helper additionally re-checks the provider before crediting: a
        // transaction can sit PENDING for 60 min and STILL have been paid out.
        // If so the refund is blocked and we reconcile to SUCCESS — this is the
        // key guard against the timeout path causing a double-money loss.
        const refund = await refundShadvalSettlement(supabase, tx, { note: `timeout ${txAgeMin}min` })
        if (refund.blockedProviderSuccess) {
          console.warn(`[Settlement Resolve] Timeout refund BLOCKED — provider confirms success (UTR ${refund.providerUtr}) for ${tx.id}. Reconciling to SUCCESS.`)
          await supabase
            .from('shadval_settlement')
            .update({
              status: 'SUCCESS',
              utr: refund.providerUtr || tx.utr || null,
              status_message: `Reconciled SUCCESS after ${txAgeMin}min — refund blocked, payout confirmed`,
              updated_at: new Date().toISOString(),
            })
            .eq('id', tx.id)
          result.resolved++
          result.results.push({ id: tx.id, ref: tx.reference_id, previous_status: 'PENDING', new_status: 'SUCCESS', action: `reconciled_success_refund_blocked_${txAgeMin}min` })
          continue
        }
        if (refund.critical) {
          console.error(`[Settlement Resolve] CRITICAL timeout refund failed for ${tx.id}:`, refund.error)
          await supabase
            .from('shadval_settlement')
            .update({
              status_message: `Auto-failed: No resolution after ${txAgeMin} minutes [CRITICAL: REFUND_FAILED - Manual review required] (${refund.error})`,
            })
            .eq('id', tx.id)
        } else if (!refund.alreadyRefunded) {
          result.refunded++
        }

        const failedTx = { ...tx, status: 'FAILED', status_message: `Auto-failed after ${txAgeMin} minutes` }
        sendSettlementCallback(tx.retailer_id, failedTx).catch(() => {})

        result.results.push({ id: tx.id, ref: tx.reference_id, previous_status: 'PENDING', new_status: 'FAILED', action: `timeout_refunded_${txAgeMin}min` })
      }
      continue
    }

    result.stillPending++
    result.results.push({ id: tx.id, ref: tx.reference_id, previous_status: 'PENDING', new_status: 'PENDING', action: 'still_pending' })
  }

  return result
}
