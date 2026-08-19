import type { SupabaseClient } from '@supabase/supabase-js'
import { checkTransactionStatus } from '@/services/shadval-pay'
import { sendSettlementCallback } from '@/lib/settlement-callback'
import { refundShadvalSettlement, isGenuineProviderSuccess } from '@/lib/settlement-2/shadval-refund'

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
 */

export interface ResolvePendingOptions {
  /** Only touch transactions older than this many minutes. Default 1. */
  staleMinutes?: number
  /** Force-fail (and refund, if not actually paid) transactions older than this. Default 60. */
  hardTimeoutMinutes?: number
  /** Max rows per sweep. Default 50. */
  limit?: number
}

export interface ResolvePendingResult {
  checked: number
  resolved: number
  refunded: number
  stillPending: number
  results: Array<{ id: string; ref: string; previous_status: string; new_status: string; action: string }>
}

export async function resolvePendingPartnerSettlements(
  supabase: SupabaseClient,
  options: ResolvePendingOptions = {}
): Promise<ResolvePendingResult> {
  const staleMinutes = options.staleMinutes ?? 1
  const hardTimeoutMinutes = options.hardTimeoutMinutes ?? 60
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

  const result: ResolvePendingResult = { checked: 0, resolved: 0, refunded: 0, stillPending: 0, results: [] }

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

    // Hard timeout: force-fail transactions older than hardTimeoutMinutes
    if (tx.created_at < hardTimeoutThreshold) {
      const txAgeMin = Math.round((Date.now() - new Date(tx.created_at).getTime()) / 60000)

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
