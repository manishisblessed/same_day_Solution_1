/**
 * AEPS Scheme-Aware Commission Settlement
 *
 * Credits the resolved AEPS commission breakdown to role wallets:
 *   RT net  -> AEPS wallet   (instant, with transaction settlement)
 *   DT net  -> primary wallet
 *   MD net  -> primary wallet
 *
 * TDS is already applied in the breakdown (md_net / distributor_net / retailer_net).
 * All credits are idempotent via deterministic reference ids.
 * Writes an audit row to commission_ledger (shared with the legacy engine).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { AEPSCommissionBreakdown } from '@/types/scheme.types';

function getSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface SettleAEPSParams {
  transactionId: string;
  transactionType: string;
  amount: number;
  rtUserId: string;
  dtUserId?: string | null;
  mdUserId?: string | null;
  breakdown: AEPSCommissionBreakdown;
}

export interface SettleAEPSResult {
  success: boolean;
  commissionId?: string;
  error?: string;
}

export async function settleAEPSCommission(params: SettleAEPSParams): Promise<SettleAEPSResult> {
  const { transactionId, transactionType, amount, rtUserId, dtUserId, mdUserId, breakdown } = params;
  const supabase = getSupabase();

  try {
    // Audit ledger record (reuses commission_ledger table)
    const { data: ledgerEntry, error: ledgerError } = await supabase
      .from('commission_ledger')
      .insert({
        transaction_id: transactionId,
        service_type: `aeps_${transactionType}`,
        total_commission: breakdown.base_commission,
        admin_amount: breakdown.company_earning,
        md_amount: breakdown.md_commission,
        dt_amount: breakdown.distributor_commission,
        rt_amount: breakdown.retailer_commission,
        company_extra_amount: breakdown.company_earning,
        tds_amount: breakdown.tds_total,
        md_user_id: mdUserId || null,
        dt_user_id: dtUserId || null,
        rt_user_id: rtUserId,
        status: 'pending',
      })
      .select('id')
      .single();

    if (ledgerError || !ledgerEntry) {
      console.error('[AEPS Settle] Failed to create ledger entry:', ledgerError?.message);
      return { success: false, error: 'Failed to create commission record' };
    }

    // RT net -> AEPS wallet
    if (breakdown.retailer_net > 0) {
      await supabase.rpc('add_ledger_entry', {
        p_user_id: rtUserId,
        p_user_role: 'retailer',
        p_wallet_type: 'aeps',
        p_fund_category: 'commission',
        p_service_type: 'aeps',
        p_tx_type: 'COMMISSION_CREDIT',
        p_credit: breakdown.retailer_net,
        p_debit: 0,
        p_reference_id: `AEPS_COMM_${transactionId}_RT`,
        p_transaction_id: transactionId,
        p_status: 'completed',
        p_remarks: `AEPS commission: ₹${breakdown.retailer_net} (after ${breakdown.tds_percentage}% TDS)`,
      });
    }

    // DT net -> primary wallet
    if (dtUserId && breakdown.distributor_net > 0) {
      await supabase.rpc('add_ledger_entry', {
        p_user_id: dtUserId,
        p_user_role: 'distributor',
        p_wallet_type: 'primary',
        p_fund_category: 'commission',
        p_service_type: 'aeps',
        p_tx_type: 'COMMISSION_CREDIT',
        p_credit: breakdown.distributor_net,
        p_debit: 0,
        p_reference_id: `AEPS_COMM_${transactionId}_DT`,
        p_transaction_id: transactionId,
        p_status: 'completed',
        p_remarks: `AEPS DT margin: ₹${breakdown.distributor_net} (after ${breakdown.tds_percentage}% TDS)`,
      });
    }

    // MD net -> primary wallet
    if (mdUserId && breakdown.md_net > 0) {
      await supabase.rpc('add_ledger_entry', {
        p_user_id: mdUserId,
        p_user_role: 'master_distributor',
        p_wallet_type: 'primary',
        p_fund_category: 'commission',
        p_service_type: 'aeps',
        p_tx_type: 'COMMISSION_CREDIT',
        p_credit: breakdown.md_net,
        p_debit: 0,
        p_reference_id: `AEPS_COMM_${transactionId}_MD`,
        p_transaction_id: transactionId,
        p_status: 'completed',
        p_remarks: `AEPS MD margin: ₹${breakdown.md_net} (after ${breakdown.tds_percentage}% TDS)`,
      });
    }

    await supabase
      .from('commission_ledger')
      .update({ status: 'distributed', distributed_at: new Date().toISOString() })
      .eq('id', ledgerEntry.id);

    console.log(`[AEPS Settle] Distributed via scheme "${breakdown.scheme_name}" (${breakdown.resolved_via}): RT ₹${breakdown.retailer_net}, DT ₹${breakdown.distributor_net}, MD ₹${breakdown.md_net}, amount ₹${amount}`);

    return { success: true, commissionId: ledgerEntry.id };
  } catch (error) {
    console.error('[AEPS Settle] Distribution error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
