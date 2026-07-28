/**
 * Shared per-transaction commission distribution (RT + DT only, no MD).
 *
 * Single source of truth for charge-based services (BBPS, Payout/Settlement-1,
 * Settlement-2/Shadval, RechargeKit, Pay2New). For each successful transaction:
 *
 *   Retailer   -> retailer_commission from the resolved scheme slab (if > 0)
 *   Distributor-> distributor_commission from the resolved scheme slab (if > 0)
 *   Company    -> remainder = totalCharge - retailerCommission - distributorCommission
 *
 * Master Distributor is intentionally NOT credited anywhere; the MD's former
 * slice folds into company revenue.
 *
 * Every credit uses a deterministic, per-transaction reference so retries and
 * concurrent runs can never double-pay (enforced by the unique index
 * idx_wallet_ledger_reference_id_user_unique on (reference_id, retailer_id)).
 *
 * AEPS is intentionally NOT handled here: it uses a different model (dedicated
 * AEPS wallet, TDS deductions, net amounts, commission_ledger audit) and is
 * maintained in services/aeps/*.
 */

import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { getPlatformRevenueWalletConfig } from '@/lib/wallet/platform-revenue-wallet'

export type ChargeCommissionService =
  | 'bbps'
  | 'payout'
  | 'shadval_settlement'
  | 'rechargekit'
  | 'pay2new'

export interface DistributeCommissionInput {
  /** Supabase admin client. Defaults to getSupabaseAdmin(). */
  supabase?: any
  /** Ledger service_type value (e.g. 'bbps', 'payout', 'shadval_settlement'). */
  service: ChargeCommissionService
  /** Uppercase reference prefix, e.g. 'BBPS', 'PAYOUT', 'SHADVAL'. */
  refPrefix: string
  /** Unique per-transaction key (agentTransactionId / clientRefId / refId). */
  refKey: string
  /** UUID of the source transaction row (p_transaction_id), if available. */
  transactionUuid?: string | null
  /** Total charge collected from the retailer for this transaction. */
  totalCharge: number
  retailer: {
    id: string
    role?: string
    walletType?: 'primary' | 'aeps'
    commission: number
  }
  distributor?: { id: string | null; commission: number } | null
  /** Extra context appended to ledger remarks (e.g. "on ₹500 bill"). */
  remarksSuffix?: string
  /** Optional: persist the credited amounts onto the source transaction row. */
  auditWriteback?: {
    table: string
    txnId: string
    retailerCol?: string
    distributorCol?: string
    companyCol?: string
  }
}

export interface DistributeCommissionResult {
  retailerCredited: number
  distributorCredited: number
  companyCredited: number
  errors: string[]
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function isDuplicate(err: any): boolean {
  const msg = (err?.message || '').toLowerCase()
  return msg.includes('duplicate') || err?.code === '23505'
}

/**
 * Distribute RT + DT commission and credit the company remainder.
 * Never throws — collects per-credit errors and returns them.
 */
export async function distributeServiceCommission(
  input: DistributeCommissionInput
): Promise<DistributeCommissionResult> {
  const supabase = input.supabase ?? getSupabaseAdmin()
  const result: DistributeCommissionResult = {
    retailerCredited: 0,
    distributorCredited: 0,
    companyCredited: 0,
    errors: [],
  }

  const totalCharge = round2(input.totalCharge || 0)
  if (totalCharge <= 0) return result

  const retailerCommission = round2(Math.max(0, input.retailer.commission || 0))
  const distributorId = input.distributor?.id || null
  const distributorCommission = distributorId
    ? round2(Math.max(0, input.distributor?.commission || 0))
    : 0
  const companyEarning = round2(totalCharge - retailerCommission - distributorCommission)

  const prefix = input.refPrefix
  const suffix = input.remarksSuffix ? ` ${input.remarksSuffix}` : ''

  // --- Retailer commission ---
  if (retailerCommission > 0) {
    const { error } = await supabase.rpc('add_ledger_entry', {
      p_user_id: input.retailer.id,
      p_user_role: input.retailer.role || 'retailer',
      p_wallet_type: input.retailer.walletType || 'primary',
      p_fund_category: 'commission',
      p_service_type: input.service,
      p_tx_type: 'COMMISSION_CREDIT',
      p_credit: retailerCommission,
      p_debit: 0,
      p_reference_id: `${prefix}-RTCOMM-${input.refKey}`,
      p_transaction_id: input.transactionUuid || null,
      p_status: 'completed',
      p_remarks: `${input.service.toUpperCase()} retailer commission ₹${retailerCommission}${suffix}`,
    })
    if (error && !isDuplicate(error)) result.errors.push(`RT: ${error.message}`)
    else result.retailerCredited = retailerCommission
  }

  // --- Distributor commission ---
  if (distributorCommission > 0 && distributorId) {
    const { error } = await supabase.rpc('add_ledger_entry', {
      p_user_id: distributorId,
      p_user_role: 'distributor',
      p_wallet_type: 'primary',
      p_fund_category: 'commission',
      p_service_type: input.service,
      p_tx_type: 'COMMISSION_CREDIT',
      p_credit: distributorCommission,
      p_debit: 0,
      p_reference_id: `${prefix}-DTCOMM-${input.refKey}`,
      p_transaction_id: input.transactionUuid || null,
      p_status: 'completed',
      p_remarks: `${input.service.toUpperCase()} distributor commission ₹${distributorCommission} (RT:${input.retailer.id})${suffix}`,
    })
    if (error && !isDuplicate(error)) result.errors.push(`DT: ${error.message}`)
    else result.distributorCredited = distributorCommission
  }

  // --- Company revenue (remainder, includes MD's former slice) ---
  if (companyEarning > 0) {
    const cfg = getPlatformRevenueWalletConfig()
    if (cfg) {
      const { error } = await supabase.rpc('add_ledger_entry', {
        p_user_id: cfg.revenueUserId,
        p_user_role: cfg.revenueUserRole,
        p_wallet_type: 'primary',
        p_fund_category: 'revenue',
        p_service_type: input.service,
        p_tx_type: 'COMPANY_REVENUE',
        p_credit: companyEarning,
        p_debit: 0,
        p_reference_id: `${prefix}-REV-${input.refKey}`,
        p_transaction_id: input.transactionUuid || null,
        p_status: 'completed',
        p_remarks: `${input.service.toUpperCase()} company revenue ₹${companyEarning} from charge ₹${totalCharge} (RT:${input.retailer.id})${suffix}`,
      })
      if (error && !isDuplicate(error)) result.errors.push(`Company: ${error.message}`)
      else result.companyCredited = companyEarning
    } else {
      result.errors.push('Company: SUBSCRIPTION_REVENUE_USER_ID not configured')
    }
  }

  // Optional: persist earned amounts onto the source transaction row for reporting.
  if (input.auditWriteback) {
    const wb = input.auditWriteback
    const patch: Record<string, number> = {}
    if (wb.retailerCol) patch[wb.retailerCol] = retailerCommission
    if (wb.distributorCol) patch[wb.distributorCol] = distributorCommission
    if (wb.companyCol) patch[wb.companyCol] = companyEarning
    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from(wb.table).update(patch).eq('id', wb.txnId)
      if (error) result.errors.push(`Audit: ${error.message}`)
    }
  }

  return result
}

/**
 * Reverse a previously distributed RT + DT + company set for a transaction
 * (e.g. failed verification). Idempotent: each reversal posts an offsetting
 * debit with a deterministic REV- reference. Never throws.
 */
export async function reverseServiceCommission(input: {
  supabase?: any
  service: ChargeCommissionService
  refPrefix: string
  refKey: string
  transactionUuid?: string | null
}): Promise<void> {
  const supabase = input.supabase ?? getSupabaseAdmin()
  const prefix = input.refPrefix
  const originalRefs = [
    { ref: `${prefix}-RTCOMM-${input.refKey}`, fund: 'commission' },
    { ref: `${prefix}-DTCOMM-${input.refKey}`, fund: 'commission' },
    { ref: `${prefix}-REV-${input.refKey}`, fund: 'revenue' },
  ]

  for (const { ref, fund } of originalRefs) {
    try {
      const { data: entries } = await supabase
        .from('wallet_ledger')
        .select('id, retailer_id, user_role, wallet_type, credit')
        .eq('reference_id', ref)
        .gt('credit', 0)

      for (const entry of entries || []) {
        const { error } = await supabase.rpc('add_ledger_entry', {
          p_user_id: entry.retailer_id,
          p_user_role: entry.user_role,
          p_wallet_type: entry.wallet_type || 'primary',
          p_fund_category: fund,
          p_service_type: input.service,
          p_tx_type: 'COMMISSION_REVERSAL',
          p_credit: 0,
          p_debit: entry.credit,
          p_reference_id: `REV-${ref}`,
          p_transaction_id: input.transactionUuid || null,
          p_status: 'completed',
          p_remarks: `Reversal of ${ref}`,
        })
        if (error && !isDuplicate(error)) {
          console.error(`[Commission Reversal] ${ref} failed:`, error.message)
        }
      }
    } catch (e: any) {
      console.error(`[Commission Reversal] ${ref} exception:`, e?.message)
    }
  }
}
