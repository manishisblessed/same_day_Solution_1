/**
 * Shared per-transaction commission distribution for the charge-based model.
 *
 * Supports TWO models (auto-detected per invocation):
 *
 * 1. CHARGE-BASED MODEL (new):
 *    Admin charges MD → MD charges DT → DT charges RT
 *    Margin at each level = selling_charge - purchase_charge
 *      RT pays: rt_purchase_charge (deducted from wallet)
 *      DT margin: rt_purchase_charge - dt_purchase_charge → credit DT wallet
 *      MD margin: dt_purchase_charge - md_purchase_charge → credit MD wallet
 *      Company margin: md_purchase_charge - company_cost → company revenue
 *
 * 2. LEGACY COMMISSION MODEL (backward compat):
 *    RT commission + DT commission explicitly defined; MD folds into company.
 *
 * Detection: if `chargeModel` field is provided in input, use charge-based.
 * Otherwise fall back to legacy.
 *
 * Every credit uses a deterministic, per-transaction reference so retries and
 * concurrent runs can never double-pay.
 *
 * AEPS is NOT handled here (separate engine in services/aeps/*).
 */

import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { getPlatformRevenueWalletConfig } from '@/lib/wallet/platform-revenue-wallet'

export type ChargeCommissionService =
  | 'bbps'
  | 'payout'
  | 'shadval_settlement'
  | 'rechargekit'
  | 'pay2new'
  | 'aeps_settlement'

export interface ChargeModelInput {
  /** What DT charges the RT (total charge collected from RT) */
  rt_purchase_charge: number
  /** What MD charges the DT */
  dt_purchase_charge: number
  /** What Admin/Company charges the MD */
  md_purchase_charge: number
  /** Vendor/provider cost to company (optional, defaults to company_charge) */
  company_cost?: number
}

export interface DistributeCommissionInput {
  supabase?: any
  service: ChargeCommissionService
  refPrefix: string
  refKey: string
  transactionUuid?: string | null
  totalCharge: number
  retailer: {
    id: string
    role?: string
    walletType?: 'primary' | 'aeps'
    commission: number
  }
  distributor?: { id: string | null; commission: number } | null
  masterDistributor?: { id: string | null } | null
  /** If provided, use the charge-based model for margin distribution */
  chargeModel?: ChargeModelInput | null
  remarksSuffix?: string
  auditWriteback?: {
    table: string
    txnId: string
    retailerCol?: string
    distributorCol?: string
    mdCol?: string
    companyCol?: string
  }
}

export interface DistributeCommissionResult {
  retailerCredited: number
  distributorCredited: number
  mdCredited: number
  companyCredited: number
  errors: string[]
  model: 'charge' | 'legacy'
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function isDuplicate(err: any): boolean {
  const msg = (err?.message || '').toLowerCase()
  return msg.includes('duplicate') || err?.code === '23505'
}

/**
 * Distribute commission/margin based on the active model.
 * Never throws — collects per-credit errors and returns them.
 */
export async function distributeServiceCommission(
  input: DistributeCommissionInput
): Promise<DistributeCommissionResult> {
  const supabase = input.supabase ?? getSupabaseAdmin()
  const result: DistributeCommissionResult = {
    retailerCredited: 0,
    distributorCredited: 0,
    mdCredited: 0,
    companyCredited: 0,
    errors: [],
    model: input.chargeModel ? 'charge' : 'legacy',
  }

  if (input.chargeModel) {
    return distributeChargeModel(supabase, input, result)
  }

  return distributeLegacyModel(supabase, input, result)
}

/**
 * CHARGE-BASED MODEL: Margin = selling_price - purchase_price at each level.
 */
async function distributeChargeModel(
  supabase: any,
  input: DistributeCommissionInput,
  result: DistributeCommissionResult
): Promise<DistributeCommissionResult> {
  const cm = input.chargeModel!
  const rtCharge = round2(cm.rt_purchase_charge || 0)
  const dtCharge = round2(cm.dt_purchase_charge || 0)
  const mdCharge = round2(cm.md_purchase_charge || 0)
  const companyCost = round2(cm.company_cost ?? 0)

  const dtMargin = round2(Math.max(0, rtCharge - dtCharge))
  const mdMargin = round2(Math.max(0, dtCharge - mdCharge))
  const companyMargin = round2(Math.max(0, mdCharge - companyCost))

  const prefix = input.refPrefix
  const suffix = input.remarksSuffix ? ` ${input.remarksSuffix}` : ''
  const distributorId = input.distributor?.id || null
  const mdId = input.masterDistributor?.id || null

  // --- DT margin credit ---
  if (dtMargin > 0 && distributorId) {
    const { error } = await supabase.rpc('add_ledger_entry', {
      p_user_id: distributorId,
      p_user_role: 'distributor',
      p_wallet_type: 'primary',
      p_fund_category: 'commission',
      p_service_type: input.service,
      p_tx_type: 'COMMISSION_CREDIT',
      p_credit: dtMargin,
      p_debit: 0,
      p_reference_id: `${prefix}-DTMARGIN-${input.refKey}`,
      p_transaction_id: input.transactionUuid || null,
      p_status: 'completed',
      p_remarks: `${input.service.toUpperCase()} DT margin ₹${dtMargin} (charge ₹${rtCharge} - ₹${dtCharge})${suffix}`,
    })
    if (error && !isDuplicate(error)) result.errors.push(`DT: ${error.message}`)
    else result.distributorCredited = dtMargin
  }

  // --- MD margin credit ---
  if (mdMargin > 0 && mdId) {
    const { error } = await supabase.rpc('add_ledger_entry', {
      p_user_id: mdId,
      p_user_role: 'master_distributor',
      p_wallet_type: 'primary',
      p_fund_category: 'commission',
      p_service_type: input.service,
      p_tx_type: 'COMMISSION_CREDIT',
      p_credit: mdMargin,
      p_debit: 0,
      p_reference_id: `${prefix}-MDMARGIN-${input.refKey}`,
      p_transaction_id: input.transactionUuid || null,
      p_status: 'completed',
      p_remarks: `${input.service.toUpperCase()} MD margin ₹${mdMargin} (charge ₹${dtCharge} - ₹${mdCharge})${suffix}`,
    })
    if (error && !isDuplicate(error)) result.errors.push(`MD: ${error.message}`)
    else result.mdCredited = mdMargin
  }

  // --- Company margin (revenue) ---
  if (companyMargin > 0) {
    const cfg = getPlatformRevenueWalletConfig()
    if (cfg) {
      const { error } = await supabase.rpc('add_ledger_entry', {
        p_user_id: cfg.revenueUserId,
        p_user_role: cfg.revenueUserRole,
        p_wallet_type: 'primary',
        p_fund_category: 'revenue',
        p_service_type: input.service,
        p_tx_type: 'COMPANY_REVENUE',
        p_credit: companyMargin,
        p_debit: 0,
        p_reference_id: `${prefix}-REV-${input.refKey}`,
        p_transaction_id: input.transactionUuid || null,
        p_status: 'completed',
        p_remarks: `${input.service.toUpperCase()} company margin ₹${companyMargin} (MD charge ₹${mdCharge} - cost ₹${companyCost}) RT:${input.retailer.id}${suffix}`,
      })
      if (error && !isDuplicate(error)) result.errors.push(`Company: ${error.message}`)
      else result.companyCredited = companyMargin
    } else {
      result.errors.push('Company: SUBSCRIPTION_REVENUE_USER_ID not configured')
    }
  }

  // --- Audit writeback ---
  if (input.auditWriteback) {
    const wb = input.auditWriteback
    const patch: Record<string, number> = {}
    if (wb.distributorCol) patch[wb.distributorCol] = dtMargin
    if (wb.mdCol) patch[wb.mdCol] = mdMargin
    if (wb.companyCol) patch[wb.companyCol] = companyMargin
    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from(wb.table).update(patch).eq('id', wb.txnId)
      if (error) result.errors.push(`Audit: ${error.message}`)
    }
  }

  return result
}

/**
 * LEGACY COMMISSION MODEL: Explicit RT + DT commissions; MD folds into company.
 * Preserved for backward compatibility with schemes that don't use charge fields.
 */
async function distributeLegacyModel(
  supabase: any,
  input: DistributeCommissionInput,
  result: DistributeCommissionResult
): Promise<DistributeCommissionResult> {
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

  // --- Company revenue (remainder) ---
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

  // --- Audit writeback ---
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
 * Reverse a previously distributed set for a transaction.
 * Handles both charge-model (DTMARGIN/MDMARGIN) and legacy (RTCOMM/DTCOMM) references.
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
  const refPatterns = [
    { ref: `${prefix}-RTCOMM-${input.refKey}`, fund: 'commission' },
    { ref: `${prefix}-DTCOMM-${input.refKey}`, fund: 'commission' },
    { ref: `${prefix}-DTMARGIN-${input.refKey}`, fund: 'commission' },
    { ref: `${prefix}-MDMARGIN-${input.refKey}`, fund: 'commission' },
    { ref: `${prefix}-REV-${input.refKey}`, fund: 'revenue' },
  ]

  for (const { ref, fund } of refPatterns) {
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
