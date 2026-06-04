/**
 * AEPS Scheme-Aware Commission Settlement
 *
 * Credits the resolved AEPS commission breakdown to role wallets:
 *   RT net  -> AEPS wallet   (instant, with transaction settlement)
 *   DT net  -> primary wallet
 *   MD net  -> primary wallet
 *
 * Each commission credit is followed by a TDS_DEDUCTION info entry so that
 * the TDS withheld is visible as a separate line item in the wallet ledger.
 *
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

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
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
      console.error('[AEPS Settle] Failed to create commission_ledger entry:', ledgerError?.message);
      return { success: false, error: 'Failed to create commission record' };
    }

    // --- RT: Credit gross commission, then record TDS deduction ---
    if (breakdown.retailer_commission > 0) {
      const rtTds = round2(breakdown.retailer_commission - breakdown.retailer_net);

      // Credit the gross commission to AEPS wallet
      const { data: rtLedgerId, error: rtErr } = await supabase.rpc('add_ledger_entry', {
        p_user_id: rtUserId,
        p_user_role: 'retailer',
        p_wallet_type: 'aeps',
        p_fund_category: 'commission',
        p_service_type: 'aeps',
        p_tx_type: 'COMMISSION_CREDIT',
        p_credit: breakdown.retailer_commission,
        p_debit: 0,
        p_reference_id: `AEPS_COMM_${transactionId}_RT`,
        p_transaction_id: transactionId,
        p_status: 'completed',
        p_remarks: `AEPS commission (gross): ₹${breakdown.retailer_commission}`,
      });

      if (rtErr) {
        console.error('[AEPS Settle] RT COMMISSION_CREDIT failed:', rtErr.message);
      }

      // Debit TDS from the same wallet so the net effect = retailer_net
      if (rtTds > 0) {
        const { error: rtTdsErr } = await supabase.rpc('add_ledger_entry', {
          p_user_id: rtUserId,
          p_user_role: 'retailer',
          p_wallet_type: 'aeps',
          p_fund_category: 'tds',
          p_service_type: 'aeps',
          p_tx_type: 'TDS_DEDUCTION',
          p_credit: 0,
          p_debit: rtTds,
          p_reference_id: `AEPS_TDS_${transactionId}_RT`,
          p_transaction_id: transactionId,
          p_status: 'completed',
          p_remarks: `TDS @${breakdown.tds_percentage}% on AEPS commission ₹${breakdown.retailer_commission}`,
        });

        if (rtTdsErr) {
          console.error('[AEPS Settle] RT TDS_DEDUCTION failed:', rtTdsErr.message);
        }
      }
    }

    // --- DT: Credit gross + TDS deduction ---
    if (dtUserId && breakdown.distributor_commission > 0) {
      const dtTds = round2(breakdown.distributor_commission - breakdown.distributor_net);

      const { error: dtErr } = await supabase.rpc('add_ledger_entry', {
        p_user_id: dtUserId,
        p_user_role: 'distributor',
        p_wallet_type: 'primary',
        p_fund_category: 'commission',
        p_service_type: 'aeps',
        p_tx_type: 'COMMISSION_CREDIT',
        p_credit: breakdown.distributor_commission,
        p_debit: 0,
        p_reference_id: `AEPS_COMM_${transactionId}_DT`,
        p_transaction_id: transactionId,
        p_status: 'completed',
        p_remarks: `AEPS DT commission (gross): ₹${breakdown.distributor_commission}`,
      });

      if (dtErr) {
        console.error('[AEPS Settle] DT COMMISSION_CREDIT failed:', dtErr.message);
      }

      if (dtTds > 0) {
        const { error: dtTdsErr } = await supabase.rpc('add_ledger_entry', {
          p_user_id: dtUserId,
          p_user_role: 'distributor',
          p_wallet_type: 'primary',
          p_fund_category: 'tds',
          p_service_type: 'aeps',
          p_tx_type: 'TDS_DEDUCTION',
          p_credit: 0,
          p_debit: dtTds,
          p_reference_id: `AEPS_TDS_${transactionId}_DT`,
          p_transaction_id: transactionId,
          p_status: 'completed',
          p_remarks: `TDS @${breakdown.tds_percentage}% on AEPS DT commission ₹${breakdown.distributor_commission}`,
        });

        if (dtTdsErr) {
          console.error('[AEPS Settle] DT TDS_DEDUCTION failed:', dtTdsErr.message);
        }
      }
    }

    // --- MD: Credit gross + TDS deduction ---
    if (mdUserId && breakdown.md_commission > 0) {
      const mdTds = round2(breakdown.md_commission - breakdown.md_net);

      const { error: mdErr } = await supabase.rpc('add_ledger_entry', {
        p_user_id: mdUserId,
        p_user_role: 'master_distributor',
        p_wallet_type: 'primary',
        p_fund_category: 'commission',
        p_service_type: 'aeps',
        p_tx_type: 'COMMISSION_CREDIT',
        p_credit: breakdown.md_commission,
        p_debit: 0,
        p_reference_id: `AEPS_COMM_${transactionId}_MD`,
        p_transaction_id: transactionId,
        p_status: 'completed',
        p_remarks: `AEPS MD commission (gross): ₹${breakdown.md_commission}`,
      });

      if (mdErr) {
        console.error('[AEPS Settle] MD COMMISSION_CREDIT failed:', mdErr.message);
      }

      if (mdTds > 0) {
        const { error: mdTdsErr } = await supabase.rpc('add_ledger_entry', {
          p_user_id: mdUserId,
          p_user_role: 'master_distributor',
          p_wallet_type: 'primary',
          p_fund_category: 'tds',
          p_service_type: 'aeps',
          p_tx_type: 'TDS_DEDUCTION',
          p_credit: 0,
          p_debit: mdTds,
          p_reference_id: `AEPS_TDS_${transactionId}_MD`,
          p_transaction_id: transactionId,
          p_status: 'completed',
          p_remarks: `TDS @${breakdown.tds_percentage}% on AEPS MD commission ₹${breakdown.md_commission}`,
        });

        if (mdTdsErr) {
          console.error('[AEPS Settle] MD TDS_DEDUCTION failed:', mdTdsErr.message);
        }
      }
    }

    await supabase
      .from('commission_ledger')
      .update({ status: 'distributed', distributed_at: new Date().toISOString() })
      .eq('id', ledgerEntry.id);

    console.log(`[AEPS Settle] Distributed via scheme "${breakdown.scheme_name}" (${breakdown.resolved_via}): RT gross ₹${breakdown.retailer_commission} net ₹${breakdown.retailer_net}, DT ₹${breakdown.distributor_net}, MD ₹${breakdown.md_net}, TDS total ₹${breakdown.tds_total}, amount ₹${amount}`);

    return { success: true, commissionId: ledgerEntry.id };
  } catch (error) {
    console.error('[AEPS Settle] Distribution error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
