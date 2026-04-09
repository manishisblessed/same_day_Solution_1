/**
 * Platform “revenue” wallet: env SUBSCRIPTION_REVENUE_USER_ID (+ role).
 * Used for subscription revenue (auto-debit) and settlement fee collection.
 */

export type PlatformRevenueWalletConfig = {
  revenueUserId: string
  revenueUserRole: 'retailer' | 'distributor' | 'master_distributor'
}

export function getPlatformRevenueWalletConfig(): PlatformRevenueWalletConfig | null {
  const revenueUserId = process.env.SUBSCRIPTION_REVENUE_USER_ID
  const role = process.env.SUBSCRIPTION_REVENUE_USER_ROLE || 'master_distributor'
  if (!revenueUserId || !['retailer', 'distributor', 'master_distributor'].includes(role)) {
    return null
  }
  return { revenueUserId, revenueUserRole: role as PlatformRevenueWalletConfig['revenueUserRole'] }
}

/**
 * Credit settlement charge (fee) to platform wallet when a bank payout completes.
 * Idempotent via reference_id SETTLEMENT_FEE_<settlementId>.
 */
export async function creditSettlementFeeToPlatformWallet(
  supabase: any,
  params: {
    settlementId: string
    charge: number
    settlerUserId: string
    settlerUserRole: string
  }
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const cfg = getPlatformRevenueWalletConfig()
  if (!cfg) {
    return { ok: true, skipped: true }
  }
  const fee = Math.round(params.charge * 100) / 100
  if (!Number.isFinite(fee) || fee <= 0) {
    return { ok: true, skipped: true }
  }

  const ref = `SETTLEMENT_FEE_${params.settlementId}`
  const { data: existing } = await supabase.from('wallet_ledger').select('id').eq('reference_id', ref).maybeSingle()
  if (existing) {
    return { ok: true, skipped: true }
  }

  const { error } = await supabase.rpc('add_ledger_entry', {
    p_user_id: cfg.revenueUserId,
    p_user_role: cfg.revenueUserRole,
    p_wallet_type: 'primary',
    p_fund_category: 'settlement',
    p_service_type: 'settlement',
    p_tx_type: 'ADJUSTMENT',
    p_credit: fee,
    p_debit: 0,
    p_reference_id: ref,
    p_transaction_id: null,
    p_status: 'completed',
    p_remarks: `Settlement fee (₹${fee.toFixed(2)}) — ${params.settlerUserRole} ${params.settlerUserId} — settlement ${params.settlementId}`,
  })

  if (error) {
    return { ok: false, error: error.message }
  }
  return { ok: true }
}
