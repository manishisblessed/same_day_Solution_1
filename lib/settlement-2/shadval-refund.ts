import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Single source of truth for refunding a failed Settlement-2 (shadval) transfer.
 *
 * WHY THIS EXISTS
 * A shadval_settlement row can be refunded from several places — the inline
 * transfer failure, the retailer/partner status poll, the admin "Check" button
 * and the check-pending cron. Historically each did its own thing:
 *   - some used add_ledger_entry with the *logged-in* role, which writes to the
 *     `wallets` table and blew up with wallets_user_role_check for partners;
 *   - the cron used refund_partner_wallet for everyone, which cannot refund a
 *     retailer;
 *   - the cron's timeout branch used a *different* reference (REFUND_TIMEOUT_…),
 *     which — combined with a REFUND_… refund from another path — could credit
 *     the same money twice.
 *
 * This is real money: a double credit or a missed refund is a direct financial
 * loss. So every path now funnels through here, which guarantees:
 *   1. ONE deterministic reference per transaction: `REFUND_<reference_id>`.
 *   2. Routing by the settler's REAL account type (partners table is
 *      authoritative), not by a UUID guess or the caller's session role:
 *        - partner  → refund_partner_wallet  (partner_wallets)
 *        - retailer → add_ledger_entry       (wallets)
 *   3. Exactly-once crediting via a pre-check for any existing refund (including
 *      the legacy REFUND_TIMEOUT_ reference) plus the per-wallet unique index as
 *      a hard backstop; a duplicate is reported as alreadyRefunded, never repaid.
 */

export interface ShadvalRefundTx {
  id: string
  retailer_id: string
  reference_id: string
  amount?: number | string | null
  charges?: number | string | null
  total_debit?: number | string | null
  actual_wallet_debit?: number | string | null
}

export interface ShadvalRefundResult {
  /** Amount considered refunded (the exact wallet debit). 0 when nothing to do. */
  refunded: number
  /** True when the credit genuinely failed AFTER the row was marked FAILED — money is stuck, needs manual review. */
  critical: boolean
  /** True when the money was already back in the wallet (idempotent no-op). */
  alreadyRefunded: boolean
  /** Which wallet backend handled it. */
  target: 'partner' | 'retailer' | 'none'
  error?: string
}

/** A duplicate ledger error means the refund was already posted — benign. */
function isDuplicateLedgerError(err: any): boolean {
  const msg = (err?.message || '').toLowerCase()
  return msg.includes('duplicate') || err?.code === '23505'
}

/** The exact amount that left the wallet: prefer the recorded debit, then fall back. */
export function computeShadvalRefundAmount(tx: ShadvalRefundTx): number {
  const recorded = parseFloat(String(tx.actual_wallet_debit ?? tx.total_debit ?? 0))
  if (recorded > 0) return recorded
  const derived = parseFloat(String(tx.amount ?? 0)) + parseFloat(String(tx.charges ?? 0))
  return derived > 0 ? derived : 0
}

/**
 * Refund a shadval settlement idempotently. Safe to call from any path and safe
 * to call repeatedly for the same transaction — it will credit at most once.
 */
export async function refundShadvalSettlement(
  supabase: SupabaseClient,
  tx: ShadvalRefundTx,
  opts?: { note?: string }
): Promise<ShadvalRefundResult> {
  const refundAmount = computeShadvalRefundAmount(tx)
  if (!(refundAmount > 0)) {
    return { refunded: 0, critical: false, alreadyRefunded: false, target: 'none' }
  }

  const refRef = `REFUND_${tx.reference_id}`
  // Legacy cron timeout reference — must be treated as the same refund so we
  // never credit a second time on top of a historical timeout refund.
  const legacyTimeoutRef = `REFUND_TIMEOUT_${tx.reference_id}`
  const note = opts?.note || 'verification'
  const description = `Settlement-2 refund ₹${refundAmount.toFixed(2)} — provider failed (${note})`

  // Authoritative account type. A UUID is NOT a reliable signal (partners and
  // some retailers both use UUIDs); the partners table is the source of truth.
  const { data: partnerRow } = await supabase
    .from('partners')
    .select('id')
    .eq('id', tx.retailer_id)
    .maybeSingle()

  if (partnerRow) {
    // Pre-check: any prior refund credit for this transaction (either the
    // canonical or the legacy timeout reference) means the money is already back.
    const { data: existing } = await supabase
      .from('partner_wallet_ledger')
      .select('id')
      .eq('partner_id', tx.retailer_id)
      .in('reference_id', [refRef, legacyTimeoutRef])
      .gt('credit', 0)
      .limit(1)
    if (existing && existing.length > 0) {
      return { refunded: refundAmount, critical: false, alreadyRefunded: true, target: 'partner' }
    }

    // NOTE: the deployed refund_partner_wallet signature is 5-arg — do NOT pass
    // p_service_type (it 404s on PostgREST).
    const { error } = await supabase.rpc('refund_partner_wallet', {
      p_partner_id: tx.retailer_id,
      p_amount: refundAmount,
      p_payout_transaction_id: tx.id,
      p_description: description,
      p_reference_id: refRef,
    })
    if (error) {
      if (isDuplicateLedgerError(error)) {
        return { refunded: refundAmount, critical: false, alreadyRefunded: true, target: 'partner' }
      }
      return { refunded: 0, critical: true, alreadyRefunded: false, target: 'partner', error: error.message }
    }
    return { refunded: refundAmount, critical: false, alreadyRefunded: false, target: 'partner' }
  }

  // Retailer path — wallet_ledger keyed by retailer_id.
  const { data: existing } = await supabase
    .from('wallet_ledger')
    .select('id')
    .eq('retailer_id', tx.retailer_id)
    .in('reference_id', [refRef, legacyTimeoutRef])
    .gt('credit', 0)
    .limit(1)
  if (existing && existing.length > 0) {
    return { refunded: refundAmount, critical: false, alreadyRefunded: true, target: 'retailer' }
  }

  const { error } = await supabase.rpc('add_ledger_entry', {
    p_user_id: tx.retailer_id,
    p_user_role: 'retailer',
    p_wallet_type: 'primary',
    p_fund_category: 'service',
    p_service_type: 'shadval_settlement',
    p_tx_type: 'SETTLEMENT2_REFUND',
    p_credit: refundAmount,
    p_debit: 0,
    p_reference_id: refRef,
    p_transaction_id: tx.id,
    p_status: 'completed',
    p_remarks: description,
  })
  if (error) {
    if (isDuplicateLedgerError(error)) {
      return { refunded: refundAmount, critical: false, alreadyRefunded: true, target: 'retailer' }
    }
    return { refunded: 0, critical: true, alreadyRefunded: false, target: 'retailer', error: error.message }
  }
  return { refunded: refundAmount, critical: false, alreadyRefunded: false, target: 'retailer' }
}
