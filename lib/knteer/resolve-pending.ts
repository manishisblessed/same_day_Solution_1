/**
 * Knteer Payout — Resolve Pending Transactions
 *
 * Mirrors lib/settlement-2/resolve-pending-partner-settlements.ts.
 *
 * SAFETY (Option C — same as shadval):
 *  • A still-PENDING payout is NEVER auto-refunded on timeout.
 *    It stays PENDING until the provider confirms failure (StatusId 5/6)
 *    or an admin refunds it manually. This prevents refunding before
 *    Knteer has actually reversed the money.
 *  • Refunds are atomic and idempotent (one REFUND_<partnerTransId> credit).
 *  • Provider re-check blocks refund if StatusId=4 (SUCCESS with UTR).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { checkKnteerStatus } from '@/services/knteer-payout'
import { refundKnteerPayout } from './refund'
import { distributeServiceCommission } from '@/lib/commission/distribute-service-commission'

export interface ResolveKnteerPendingOptions {
  /** Only touch transactions older than this many minutes. Default 2. */
  staleMinutes?: number
  /** Age (minutes) at which a still-PENDING row is HELD with an alert. Default 60. */
  hardTimeoutMinutes?: number
  /** Max rows per run. Default 50. */
  limit?: number
}

export interface ResolveKnteerPendingResult {
  checked: number
  resolved: number
  refunded: number
  stillPending: number
  timeoutHeld: number
  results: Array<{
    id: string
    partner_trans_id: string
    previous_status: string
    new_status: string
    action: string
  }>
}

export async function resolvePendingKnteerPayouts(
  supabase: SupabaseClient,
  options: ResolveKnteerPendingOptions = {}
): Promise<ResolveKnteerPendingResult> {
  const staleMinutes = options.staleMinutes ?? 2
  const hardTimeoutMinutes = options.hardTimeoutMinutes ?? 60
  const limit = options.limit ?? 50

  const staleThreshold = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString()
  const hardTimeoutThreshold = new Date(Date.now() - hardTimeoutMinutes * 60 * 1000).toISOString()

  const { data: pendingTxs, error } = await supabase
    .from('knteer_payout_transactions')
    .select('id, retailer_id, user_role, partner_trans_id, knteer_trans_id, amount, charges, actual_wallet_debit, payment_mode, account_number, ifsc_code, account_holder_name, scheme_id, distributor_id, distributor_commission, md_commission, company_earning, status_message, created_at')
    .eq('status', 'PENDING')
    .lt('created_at', staleThreshold)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`Knteer resolve-pending fetch failed: ${error.message}`)

  const result: ResolveKnteerPendingResult = {
    checked: 0, resolved: 0, refunded: 0, stillPending: 0, timeoutHeld: 0, results: [],
  }

  if (!pendingTxs || pendingTxs.length === 0) return result

  for (const tx of pendingTxs) {
    result.checked++

    if (!tx.partner_trans_id) {
      result.stillPending++
      result.results.push({ id: tx.id, partner_trans_id: '', previous_status: 'PENDING', new_status: 'PENDING', action: 'no_ref' })
      continue
    }

    // ── Check provider status ─────────────────────────────────────────────────
    let statusResult: Awaited<ReturnType<typeof checkKnteerStatus>> | null = null
    try {
      statusResult = await checkKnteerStatus(tx.partner_trans_id)
    } catch (e: any) {
      console.error('[KnteerResolve] Status check error:', { txId: tx.id, error: e?.message })
    }

    if (statusResult?.success && statusResult.status !== 'pending') {
      const isSuccess = statusResult.status === 'success' && !!statusResult.utr
      const isFailed = statusResult.status === 'failed'

      if (!isSuccess && !isFailed) {
        // Still pending — fall through to timeout handling
      } else {
        const newStatus = isSuccess ? 'SUCCESS' : 'FAILED'

        // Atomically claim the transition
        const { data: claimed } = await supabase
          .from('knteer_payout_transactions')
          .update({
            status: newStatus,
            utr: statusResult.utr || null,
            knteer_trans_id: statusResult.knteer_trans_id || tx.knteer_trans_id || null,
            status_id: statusResult.status_id || null,
            status_message: isSuccess ? `SUCCESS — UTR ${statusResult.utr}` : 'FAILED at provider',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', tx.id)
          .eq('status', 'PENDING')
          .select('id')

        if (!claimed || claimed.length === 0) {
          // Another process already claimed it
          result.results.push({ id: tx.id, partner_trans_id: tx.partner_trans_id, previous_status: 'PENDING', new_status: 'PENDING', action: 'already_claimed' })
          continue
        }

        if (isFailed) {
          const refund = await refundKnteerPayout(supabase, tx)
          if (refund.blockedProviderSuccess) {
            // Provider now shows SUCCESS — undo the FAILED flip
            console.warn('[KnteerResolve] Refund BLOCKED — reconciling to SUCCESS:', { txId: tx.id })
            await supabase
              .from('knteer_payout_transactions')
              .update({
                status: 'SUCCESS',
                utr: refund.providerUtr || null,
                status_message: `Reconciled SUCCESS — refund blocked, payout confirmed`,
                updated_at: new Date().toISOString(),
              })
              .eq('id', tx.id)
            // Book revenue for reconciled success
            await bookKnteerRevenue(supabase, tx).catch(e => console.error('[KnteerResolve] revenue booking failed:', e))
            result.resolved++
            result.results.push({ id: tx.id, partner_trans_id: tx.partner_trans_id, previous_status: 'PENDING', new_status: 'SUCCESS', action: 'reconciled_success_refund_blocked' })
            continue
          }
          if (!refund.alreadyRefunded) result.refunded++
        }

        if (isSuccess) {
          await bookKnteerRevenue(supabase, tx).catch(e => console.error('[KnteerResolve] revenue booking failed:', e))
        }

        result.resolved++
        result.results.push({
          id: tx.id,
          partner_trans_id: tx.partner_trans_id,
          previous_status: 'PENDING',
          new_status: newStatus,
          action: isFailed ? 'resolved_failed_refunded' : 'resolved_success',
        })
        continue
      }
    }

    // ── Hard timeout — HOLD (Option C, no auto-refund) ────────────────────────
    if (tx.created_at < hardTimeoutThreshold) {
      const txAgeMin = Math.round((Date.now() - new Date(tx.created_at).getTime()) / 60000)
      const holdMarker = '[HOLD: awaiting Knteer confirmation — no auto-refund]'

      if (!(tx.status_message || '').includes(holdMarker)) {
        await supabase
          .from('knteer_payout_transactions')
          .update({
            status_message: `Pending ${txAgeMin} min — ${holdMarker}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', tx.id)
          .eq('status', 'PENDING')
      }

      console.warn('[KnteerResolve] HOLD — past hard timeout:', { txId: tx.id, ageMin: txAgeMin, partnerTransId: tx.partner_trans_id })
      result.timeoutHeld++
      result.stillPending++
      result.results.push({ id: tx.id, partner_trans_id: tx.partner_trans_id, previous_status: 'PENDING', new_status: 'PENDING', action: `timeout_hold_${txAgeMin}min` })
      continue
    }

    result.stillPending++
    result.results.push({ id: tx.id, partner_trans_id: tx.partner_trans_id, previous_status: 'PENDING', new_status: 'PENDING', action: 'still_pending' })
  }

  return result
}

/** Book commission revenue for a confirmed-success Knteer payout */
async function bookKnteerRevenue(supabase: SupabaseClient, tx: any): Promise<void> {
  const charges = parseFloat(String(tx.charges || 0))
  if (charges <= 0) return
  await distributeServiceCommission({
    supabase,
    service: 'knteer_payout',
    refPrefix: 'KNTEER',
    refKey: tx.partner_trans_id,
    transactionUuid: tx.id,
    totalCharge: charges,
    retailer: { id: tx.retailer_id, role: tx.user_role || 'retailer', commission: 0 },
    distributor: { id: tx.distributor_id || null, commission: parseFloat(String(tx.distributor_commission || 0)) },
    masterDistributor: { id: null },
    remarksSuffix: `on ₹${tx.amount} knteer payout`,
    auditWriteback: {
      table: 'knteer_payout_transactions',
      txnId: tx.id,
      distributorCol: 'distributor_commission',
      mdCol: 'md_commission',
      companyCol: 'company_earning',
    },
  })
}
