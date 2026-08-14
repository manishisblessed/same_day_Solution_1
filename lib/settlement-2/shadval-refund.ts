import type { SupabaseClient } from '@supabase/supabase-js'
import { checkTransactionStatus } from '@/services/shadval-pay'

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
 *   4. An ANTI-LOSS GUARD: before crediting, the provider is re-checked and a
 *      refund is REFUSED (blockedProviderSuccess) if the payout genuinely
 *      succeeded (a UTR exists). This stops the "bank got paid AND wallet was
 *      refunded" double-money loss at the single choke-point.
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
  /**
   * True when the refund was REFUSED because the provider confirms the bank
   * payout genuinely succeeded (money left — a UTR exists). This is the
   * anti-loss guard: the caller MUST reconcile the row to SUCCESS instead of
   * treating it as failed, and must NOT reverse commission.
   */
  blockedProviderSuccess: boolean
  /** UTR reported by the provider when the refund was blocked (money moved). */
  providerUtr?: string
  /** Which wallet backend handled it. */
  target: 'partner' | 'retailer' | 'none'
  error?: string
}

/** A duplicate ledger error means the refund was already posted — benign. */
function isDuplicateLedgerError(err: any): boolean {
  const msg = (err?.message || '').toLowerCase()
  return msg.includes('duplicate') || err?.code === '23505'
}

/**
 * The ONE safe definition of a genuine, money-has-already-left provider success.
 *
 * A real payout success ALWAYS carries a UTR and a status text that says
 * "success" without any refund / reversal / failure / pending / initiated /
 * processing qualifier. This is used both to reconcile records to SUCCESS and —
 * critically — to BLOCK refunds: once the bank transfer has demonstrably left,
 * crediting the wallet again is a direct financial loss.
 */
export function isGenuineProviderSuccess(
  statusResult:
    | { status?: string; data?: { txn_status?: string; utr?: string } | null }
    | null
    | undefined
): boolean {
  if (!statusResult || statusResult.status !== 'SUCCESS' || !statusResult.data) return false
  const s = (statusResult.data.txn_status || '').toLowerCase()
  const hasUtr = !!statusResult.data.utr
  return (
    hasUtr &&
    s.includes('success') &&
    !s.includes('refund') &&
    !s.includes('revers') &&
    !s.includes('fail') &&
    !s.includes('initiat') &&
    !s.includes('pending') &&
    !s.includes('process')
  )
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
  opts?: { note?: string; verifyProvider?: boolean }
): Promise<ShadvalRefundResult> {
  const refundAmount = computeShadvalRefundAmount(tx)
  if (!(refundAmount > 0)) {
    return { refunded: 0, critical: false, alreadyRefunded: false, blockedProviderSuccess: false, target: 'none' }
  }

  const refRef = `REFUND_${tx.reference_id}`
  // Legacy cron timeout reference — must be treated as the same refund so we
  // never credit a second time on top of a historical timeout refund.
  const legacyTimeoutRef = `REFUND_TIMEOUT_${tx.reference_id}`
  const note = opts?.note || 'verification'
  // Callers that have ALREADY confirmed the provider did not succeed (e.g. the
  // admin reversal tool) can skip the live re-check. Everything else verifies.
  const verifyProvider = opts?.verifyProvider !== false
  const description = `Settlement-2 refund ₹${refundAmount.toFixed(2)} — provider failed (${note})`

  // Authoritative account type. A UUID is NOT a reliable signal (partners and
  // some retailers both use UUIDs); the partners table is the source of truth.
  const { data: partnerRow } = await supabase
    .from('partners')
    .select('id')
    .eq('id', tx.retailer_id)
    .maybeSingle()
  const target: 'partner' | 'retailer' = partnerRow ? 'partner' : 'retailer'
  const ledgerTable = target === 'partner' ? 'partner_wallet_ledger' : 'wallet_ledger'
  const idCol = target === 'partner' ? 'partner_id' : 'retailer_id'

  // Pre-check: any prior refund credit for this transaction (either the
  // canonical or the legacy timeout reference) means the money is already back.
  const { data: existing } = await supabase
    .from(ledgerTable)
    .select('id')
    .eq(idCol, tx.retailer_id)
    .in('reference_id', [refRef, legacyTimeoutRef])
    .gt('credit', 0)
    .limit(1)
  if (existing && existing.length > 0) {
    return { refunded: refundAmount, critical: false, alreadyRefunded: true, blockedProviderSuccess: false, target }
  }

  // ── ANTI-LOSS GUARD ────────────────────────────────────────────────────
  // Before crediting anything, make sure the bank payout did NOT actually
  // succeed. Every automatic path (status poll, check-pending, 60-min timeout)
  // funnels through here, so this one check protects them all: if the provider
  // confirms a genuine success (money left, UTR present) we REFUSE to refund
  // and tell the caller to reconcile the row to SUCCESS instead. This is the
  // exact situation that caused the double-money loss (bank got paid AND wallet
  // was credited back).
  if (verifyProvider && tx.reference_id) {
    try {
      const statusResult = await checkTransactionStatus({ reference_id: tx.reference_id })
      if (isGenuineProviderSuccess(statusResult)) {
        return {
          refunded: 0,
          critical: false,
          alreadyRefunded: false,
          blockedProviderSuccess: true,
          providerUtr: statusResult.data?.utr || undefined,
          target,
        }
      }
    } catch {
      // Provider unreachable — the caller already believes this failed, so we
      // fall through and refund. Any successful-but-unverifiable payout is
      // caught later by the reconciliation sweep (scripts/reconcile-*).
    }
  }

  if (target === 'partner') {
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
        return { refunded: refundAmount, critical: false, alreadyRefunded: true, blockedProviderSuccess: false, target: 'partner' }
      }
      return { refunded: 0, critical: true, alreadyRefunded: false, blockedProviderSuccess: false, target: 'partner', error: error.message }
    }
    return { refunded: refundAmount, critical: false, alreadyRefunded: false, blockedProviderSuccess: false, target: 'partner' }
  }

  // Retailer path — wallet_ledger keyed by retailer_id.
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
      return { refunded: refundAmount, critical: false, alreadyRefunded: true, blockedProviderSuccess: false, target: 'retailer' }
    }
    return { refunded: 0, critical: true, alreadyRefunded: false, blockedProviderSuccess: false, target: 'retailer', error: error.message }
  }
  return { refunded: refundAmount, critical: false, alreadyRefunded: false, blockedProviderSuccess: false, target: 'retailer' }
}
