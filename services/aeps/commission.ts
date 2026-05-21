/**
 * AEPS Commission Engine
 * Calculates slab-based commission and distributes to role hierarchy.
 *
 * Flow: API Partner pays per-txn commission → Company keeps admin margin →
 *       Remaining distributed: MD 10%, DT 15%, RT 65%, Company extra 10%
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface CommissionSlab {
  service_type: string;
  slab_min: number;
  slab_max: number;
  value: number;
  value_type: 'percentage' | 'flat';
}

export interface DistributionConfig {
  service_type: string;
  admin_margin_pct: number;
  md_share_pct: number;
  dt_share_pct: number;
  rt_share_pct: number;
  company_extra_pct: number;
  tds_pct: number;
  rt_wallet_type: string;
  md_wallet_type: string;
  dt_wallet_type: string;
}

export interface CommissionResult {
  totalCommission: number;
  adminAmount: number;
  mdAmount: number;
  dtAmount: number;
  rtAmount: number;
  companyExtraAmount: number;
  tdsAmount: number;
}

export interface DistributeParams {
  transactionId: string;
  serviceType: string;
  amount: number;
  rtUserId: string;
  dtUserId?: string;
  mdUserId?: string;
}

function getSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Map transaction type to service_type key used in slabs table
 */
export function mapTransactionTypeToServiceType(transactionType: string): string {
  const map: Record<string, string> = {
    cash_withdrawal: 'aeps_withdrawal',
    cash_deposit: 'aeps_deposit',
    mini_statement: 'aeps_mini_statement',
    balance_inquiry: 'aeps_balance_inquiry',
    aadhaar_to_aadhaar: 'aeps_withdrawal',
  };
  return map[transactionType] || 'aeps_withdrawal';
}

/**
 * Calculate commission amount from slab config
 */
export async function calculateCommission(
  serviceType: string,
  amount: number
): Promise<number> {
  const supabase = getSupabase();

  const { data: slabs } = await supabase
    .from('service_slabs')
    .select('slab_min, slab_max, value, value_type')
    .eq('service_type', serviceType)
    .eq('is_active', true)
    .lte('slab_min', amount)
    .gte('slab_max', amount)
    .limit(1);

  if (!slabs || slabs.length === 0) {
    return 0;
  }

  const slab = slabs[0];

  if (slab.value_type === 'percentage') {
    return Math.round((amount * slab.value / 100) * 100) / 100;
  }

  return slab.value;
}

/**
 * Get distribution config for a service type
 */
export async function getDistributionConfig(serviceType: string): Promise<DistributionConfig | null> {
  const supabase = getSupabase();

  const { data } = await supabase
    .from('commission_distribution')
    .select('*')
    .eq('service_type', serviceType)
    .eq('is_active', true)
    .single();

  return data;
}

/**
 * Calculate full commission breakdown
 */
export function computeDistribution(
  totalCommission: number,
  config: DistributionConfig
): CommissionResult {
  if (totalCommission <= 0) {
    return {
      totalCommission: 0,
      adminAmount: 0,
      mdAmount: 0,
      dtAmount: 0,
      rtAmount: 0,
      companyExtraAmount: 0,
      tdsAmount: 0,
    };
  }

  const adminAmount = Math.round((totalCommission * config.admin_margin_pct / 100) * 100) / 100;
  const distributable = totalCommission - adminAmount;

  const mdAmount = Math.round((distributable * config.md_share_pct / 100) * 100) / 100;
  const dtAmount = Math.round((distributable * config.dt_share_pct / 100) * 100) / 100;
  const rtAmount = Math.round((distributable * config.rt_share_pct / 100) * 100) / 100;
  const companyExtraAmount = Math.round((distributable * config.company_extra_pct / 100) * 100) / 100;

  // TDS is deducted from each role's share before crediting
  const tdsAmount = Math.round(((mdAmount + dtAmount + rtAmount) * config.tds_pct / 100) * 100) / 100;

  return {
    totalCommission,
    adminAmount,
    mdAmount,
    dtAmount,
    rtAmount,
    companyExtraAmount,
    tdsAmount,
  };
}

/**
 * Distribute commission to all roles' wallets.
 * Called after a successful AEPS financial transaction.
 */
export async function distributeCommission(params: DistributeParams): Promise<{
  success: boolean;
  commissionId?: string;
  breakdown?: CommissionResult;
  error?: string;
}> {
  const { transactionId, serviceType, amount, rtUserId, dtUserId, mdUserId } = params;

  try {
    const totalCommission = await calculateCommission(serviceType, amount);

    if (totalCommission <= 0) {
      return { success: true, breakdown: computeDistribution(0, {} as DistributionConfig) };
    }

    const config = await getDistributionConfig(serviceType);
    if (!config) {
      console.error('[Commission] No distribution config for:', serviceType);
      return { success: false, error: 'No distribution config found' };
    }

    const breakdown = computeDistribution(totalCommission, config);
    const supabase = getSupabase();

    // Insert commission ledger record
    const { data: ledgerEntry, error: ledgerError } = await supabase
      .from('commission_ledger')
      .insert({
        transaction_id: transactionId,
        service_type: serviceType,
        total_commission: breakdown.totalCommission,
        admin_amount: breakdown.adminAmount,
        md_amount: breakdown.mdAmount,
        dt_amount: breakdown.dtAmount,
        rt_amount: breakdown.rtAmount,
        company_extra_amount: breakdown.companyExtraAmount,
        tds_amount: breakdown.tdsAmount,
        md_user_id: mdUserId || null,
        dt_user_id: dtUserId || null,
        rt_user_id: rtUserId,
        status: 'pending',
      })
      .select('id')
      .single();

    if (ledgerError || !ledgerEntry) {
      console.error('[Commission] Failed to create ledger entry:', ledgerError);
      return { success: false, error: 'Failed to create commission record' };
    }

    // Credit RT wallet (AEPS wallet — instant with transaction)
    const rtNet = Math.round((breakdown.rtAmount * (1 - config.tds_pct / 100)) * 100) / 100;
    if (rtNet > 0) {
      await supabase.rpc('add_ledger_entry', {
        p_user_id: rtUserId,
        p_user_role: 'retailer',
        p_wallet_type: config.rt_wallet_type,
        p_fund_category: 'commission',
        p_service_type: 'aeps',
        p_tx_type: 'COMMISSION_CREDIT',
        p_credit: rtNet,
        p_debit: 0,
        p_reference_id: `COMM_${transactionId}`,
        p_transaction_id: transactionId,
        p_status: 'completed',
        p_remarks: `AEPS commission: ₹${rtNet} (after TDS)`,
      });
    }

    // Credit DT wallet (Primary wallet)
    if (dtUserId && breakdown.dtAmount > 0) {
      const dtNet = Math.round((breakdown.dtAmount * (1 - config.tds_pct / 100)) * 100) / 100;
      if (dtNet > 0) {
        await supabase.rpc('add_ledger_entry', {
          p_user_id: dtUserId,
          p_user_role: 'distributor',
          p_wallet_type: config.dt_wallet_type,
          p_fund_category: 'commission',
          p_service_type: 'aeps',
          p_tx_type: 'COMMISSION_CREDIT',
          p_credit: dtNet,
          p_debit: 0,
          p_reference_id: `COMM_DT_${transactionId}`,
          p_transaction_id: transactionId,
          p_status: 'completed',
          p_remarks: `AEPS DT commission: ₹${dtNet} (after TDS)`,
        });
      }
    }

    // Credit MD wallet (Primary wallet)
    if (mdUserId && breakdown.mdAmount > 0) {
      const mdNet = Math.round((breakdown.mdAmount * (1 - config.tds_pct / 100)) * 100) / 100;
      if (mdNet > 0) {
        await supabase.rpc('add_ledger_entry', {
          p_user_id: mdUserId,
          p_user_role: 'master_distributor',
          p_wallet_type: config.md_wallet_type,
          p_fund_category: 'commission',
          p_service_type: 'aeps',
          p_tx_type: 'COMMISSION_CREDIT',
          p_credit: mdNet,
          p_debit: 0,
          p_reference_id: `COMM_MD_${transactionId}`,
          p_transaction_id: transactionId,
          p_status: 'completed',
          p_remarks: `AEPS MD commission: ₹${mdNet} (after TDS)`,
        });
      }
    }

    // Mark commission as distributed
    await supabase
      .from('commission_ledger')
      .update({ status: 'distributed', distributed_at: new Date().toISOString() })
      .eq('id', ledgerEntry.id);

    return { success: true, commissionId: ledgerEntry.id, breakdown };
  } catch (error) {
    console.error('[Commission] Distribution error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
