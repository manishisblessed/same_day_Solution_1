/**
 * Knteer Payout — Atomic Idempotent Refund
 *
 * Mirrors lib/settlement-2/shadval-refund.ts safety guarantees:
 *  1. Exactly-once credit via deterministic reference REFUND_<partnerTransId>
 *  2. Always re-checks provider status before crediting — refuses to refund if
 *     Knteer confirms StatusId=4 (SUCCESS with UTR) to prevent double-money.
 *  3. Works for both retailer and partner wallets.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { checkKnteerStatus } from '@/services/knteer-payout'

export interface KnteerRefundOptions {
  note?: string
  /** Skip the provider re-check (only when caller ALREADY has a confirmed terminal failure) */
  skipProviderCheck?: boolean
}

export interface KnteerRefundResult {
  refunded: boolean
  alreadyRefunded: boolean
  /** true when provider re-check found SUCCESS — refund was blocked to prevent double-money */
  blockedProviderSuccess: boolean
  providerUtr?: string
  critical?: boolean
  error?: string
}

/**
 * Idempotent wallet refund for a failed Knteer payout.
 *
 * @param supabase         Service-role client
 * @param tx               Row from knteer_payout_transactions
 * @param options
 */
export async function refundKnteerPayout(
  supabase: SupabaseClient,
  tx: {
    id: string
    retailer_id: string
    user_role?: string
    partner_trans_id: string
    actual_wallet_debit?: number
    charges?: number
    amount: number
  },
  options: KnteerRefundOptions = {}
): Promise<KnteerRefundResult> {
  const refundRef = `REFUND_${tx.partner_trans_id}`
  const refundAmount = tx.actual_wallet_debit ?? (tx.amount + (tx.charges ?? 0))
  const isPartner = tx.user_role === 'partner'

  // ── 1. Idempotency — was this already refunded? ───────────────────────────
  const table = isPartner ? 'partner_wallet_ledger' : 'wallet_ledger'
  const idCol = isPartner ? 'partner_id' : 'retailer_id'

  const { data: existing } = await supabase
    .from(table)
    .select('id')
    .eq(idCol, tx.retailer_id)
    .eq('reference_id', refundRef)
    .gt('credit', 0)
    .limit(1)

  if (existing && existing.length > 0) {
    console.log('[KnteerRefund] Already refunded:', { txId: tx.id, ref: refundRef })
    return { refunded: false, alreadyRefunded: true, blockedProviderSuccess: false }
  }

  // ── 2. Provider re-check — never refund a successful payout ──────────────
  if (!options.skipProviderCheck) {
    try {
      const statusResult = await checkKnteerStatus(tx.partner_trans_id)
      if (statusResult.success && statusResult.status === 'success' && statusResult.utr) {
        console.warn('[KnteerRefund] BLOCKED — provider confirms SUCCESS with UTR:', {
          txId: tx.id, utr: statusResult.utr, partnerTransId: tx.partner_trans_id,
        })
        return {
          refunded: false,
          alreadyRefunded: false,
          blockedProviderSuccess: true,
          providerUtr: statusResult.utr,
        }
      }
    } catch (e: any) {
      // Status check failed — do NOT block the refund; log and proceed
      console.warn('[KnteerRefund] Provider re-check error (proceeding with refund):', e?.message)
    }
  }

  // ── 3. Issue refund ───────────────────────────────────────────────────────
  try {
    if (isPartner) {
      const { error } = await (supabase as any).rpc('credit_partner_wallet', {
        p_partner_id: tx.retailer_id,
        p_amount: refundAmount,
        p_description: `Knteer payout refund ₹${refundAmount.toFixed(2)} — ${tx.partner_trans_id} (${options.note || 'auto'})`,
        p_reference_id: refundRef,
        p_transaction_type: 'REFUND',
        p_service_type: 'knteer_payout',
      })
      if (error) throw new Error(error.message)
    } else {
      const { error } = await (supabase as any).rpc('add_ledger_entry', {
        p_user_id: tx.retailer_id,
        p_user_role: tx.user_role || 'retailer',
        p_wallet_type: 'primary',
        p_fund_category: 'service',
        p_service_type: 'knteer_payout',
        p_tx_type: 'KNTEER_PAYOUT_REFUND',
        p_credit: refundAmount,
        p_debit: 0,
        p_reference_id: refundRef,
        p_transaction_id: tx.id,
        p_status: 'completed',
        p_remarks: `Knteer payout refund ₹${refundAmount.toFixed(2)} — ${tx.partner_trans_id} (${options.note || 'auto'})`,
      })
      if (error) throw new Error(error.message)
    }

    console.log('[KnteerRefund] Refunded:', { txId: tx.id, ref: refundRef, amount: refundAmount })
    return { refunded: true, alreadyRefunded: false, blockedProviderSuccess: false }
  } catch (err: any) {
    console.error('[KnteerRefund] CRITICAL refund failed:', { txId: tx.id, error: err.message })
    return {
      refunded: false,
      alreadyRefunded: false,
      blockedProviderSuccess: false,
      critical: true,
      error: err.message,
    }
  }
}
