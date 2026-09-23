import { SupabaseClient } from '@supabase/supabase-js'

/**
 * Shared finalize logic for a retailer Rechargekit CC transaction that lives in
 * `bbps_transactions`. Used by BOTH the async callback (`/api/rechargekit/callback`)
 * and the admin/retailer on-demand status check (verify + `/api/rechargekit/status`)
 * so money movement (commission credit / wallet refund) is identical no matter
 * how the final status is discovered.
 *
 * Idempotency: ledger writes use deterministic reference_ids
 * (`RKCC_COMM_<requestId>`, `REFUND_<requestId>`) so re-running is safe — the DB
 * unique index on wallet_ledger.reference_id is the hard backstop.
 *
 * Provider status codes: 1 = SUCCESS, 2 = PENDING, 3 = FAILED.
 */

export type RechargekitFinalizeAction =
  | 'marked_success'
  | 'failed_and_refunded'
  | 'still_pending'
  | 'already_finalized'

export interface RechargekitTxRow {
  id: string
  status: string
  retailer_id: string
  bill_amount: number
  scheme_id: string | null
  additional_info: any
}

export interface RechargekitFinalizeResult {
  action: RechargekitFinalizeAction
  status: 'success' | 'failed' | 'pending'
  refunded: boolean
  refundedAmount: number
}

export async function finalizeRechargekitRetailerTxn(
  supabaseAdmin: SupabaseClient,
  tx: RechargekitTxRow,
  requestId: string,
  providerStatus: number,
  orderId: string,
  operatorRef: string,
  providerMsg: string
): Promise<RechargekitFinalizeResult> {
  // Already finalized — do nothing (idempotent).
  if (tx.status === 'success' || tx.status === 'failed') {
    return {
      action: 'already_finalized',
      status: tx.status as 'success' | 'failed',
      refunded: false,
      refundedAmount: 0,
    }
  }

  const updatedInfo = {
    ...(tx.additional_info || {}),
    provider_txn_id: orderId || requestId,
    operator_reference: operatorRef,
    callback_status: providerStatus,
    callback_msg: providerMsg,
    last_status_check: new Date().toISOString(),
  }

  // ---- SUCCESS ----
  if (providerStatus === 1) {
    await supabaseAdmin
      .from('bbps_transactions')
      .update({
        status: 'success',
        payment_status: 'success',
        transaction_id: orderId || requestId,
        completed_at: new Date().toISOString(),
        additional_info: updatedInfo,
      })
      .eq('id', tx.id)
      .in('status', ['pending', 'processing', 'initiated'])

    // Distribute commissions for successful payment (non-fatal on error).
    try {
      const { data: retailerData } = await supabaseAdmin
        .from('retailers')
        .select('distributor_id, master_distributor_id')
        .eq('partner_id', tx.retailer_id)
        .maybeSingle()

      const distributorId = retailerData?.distributor_id || null
      const mdId = retailerData?.master_distributor_id || null

      if (tx.scheme_id) {
        const { data: chargeResult } = await supabaseAdmin.rpc(
          'calculate_bbps_charge_from_scheme',
          { p_scheme_id: tx.scheme_id, p_amount: tx.bill_amount, p_category: 'Credit Card' }
        )
        if (chargeResult?.length > 0) {
          const commSplit = {
            retailer_commission: parseFloat(chargeResult[0].retailer_commission) || 0,
            distributor_commission: parseFloat(chargeResult[0].distributor_commission) || 0,
            md_commission: parseFloat(chargeResult[0].md_commission) || 0,
          }
          const txRef = `RKCC_COMM_${requestId}`
          if (commSplit.retailer_commission > 0) {
            await supabaseAdmin.rpc('add_ledger_entry', {
              p_user_id: tx.retailer_id,
              p_user_role: 'retailer',
              p_wallet_type: 'primary',
              p_fund_category: 'commission',
              p_service_type: 'rechargekit',
              p_tx_type: 'COMMISSION_CREDIT',
              p_credit: commSplit.retailer_commission,
              p_debit: 0,
              p_reference_id: txRef,
              p_transaction_id: tx.id,
              p_status: 'completed',
              p_remarks: `Commission on CC-2 ₹${tx.bill_amount}`,
            })
          }
          if (commSplit.distributor_commission > 0 && distributorId) {
            await supabaseAdmin.rpc('add_ledger_entry', {
              p_user_id: distributorId,
              p_user_role: 'distributor',
              p_wallet_type: 'primary',
              p_fund_category: 'commission',
              p_service_type: 'rechargekit',
              p_tx_type: 'COMMISSION_CREDIT',
              p_credit: commSplit.distributor_commission,
              p_debit: 0,
              p_reference_id: txRef,
              p_status: 'completed',
              p_remarks: `DT commission on CC-2 ₹${tx.bill_amount} (RT:${tx.retailer_id})`,
            })
          }
          if (commSplit.md_commission > 0 && mdId) {
            await supabaseAdmin.rpc('add_ledger_entry', {
              p_user_id: mdId,
              p_user_role: 'master_distributor',
              p_wallet_type: 'primary',
              p_fund_category: 'commission',
              p_service_type: 'rechargekit',
              p_tx_type: 'COMMISSION_CREDIT',
              p_credit: commSplit.md_commission,
              p_debit: 0,
              p_reference_id: txRef,
              p_status: 'completed',
              p_remarks: `MD commission on CC-2 ₹${tx.bill_amount} (RT:${tx.retailer_id})`,
            })
          }
        }
      }
    } catch (commErr: any) {
      console.error('[Rechargekit Finalize] Commission error (non-fatal):', commErr.message)
    }

    return { action: 'marked_success', status: 'success', refunded: false, refundedAmount: 0 }
  }

  // ---- FAILED — refund the wallet ----
  if (providerStatus === 3) {
    await supabaseAdmin
      .from('bbps_transactions')
      .update({
        status: 'failed',
        payment_status: 'failed',
        error_message: providerMsg || 'Payment failed',
        completed_at: new Date().toISOString(),
        additional_info: updatedInfo,
      })
      .eq('id', tx.id)
      .in('status', ['pending', 'processing', 'initiated'])

    // Mark original debit ledger entry as failed
    await supabaseAdmin
      .from('wallet_ledger')
      .update({ status: 'failed' })
      .eq('reference_id', requestId)
      .eq('transaction_type', 'RECHARGEKIT_CC_DEBIT')

    // Refund: get original debit amount from ledger
    const { data: debitEntry } = await supabaseAdmin
      .from('wallet_ledger')
      .select('debit, user_role')
      .eq('reference_id', requestId)
      .eq('transaction_type', 'RECHARGEKIT_CC_DEBIT')
      .maybeSingle()

    let refundedAmount = 0
    if (debitEntry && debitEntry.debit > 0) {
      const { error: refundErr } = await supabaseAdmin.rpc('add_ledger_entry', {
        p_user_id: tx.retailer_id,
        p_user_role: debitEntry.user_role || 'retailer',
        p_wallet_type: 'primary',
        p_fund_category: 'service',
        p_service_type: 'rechargekit',
        p_tx_type: 'RECHARGEKIT_CC_REFUND',
        p_credit: debitEntry.debit,
        p_debit: 0,
        p_reference_id: `REFUND_${requestId}`,
        p_transaction_id: tx.id,
        p_status: 'completed',
        p_remarks: `Refund ₹${debitEntry.debit} | CC-2 failed: ${providerMsg}`,
      })
      // Duplicate reference_id => refund already posted by another path; treat as success.
      const dup =
        refundErr &&
        ((refundErr.message || '').toLowerCase().includes('duplicate') || (refundErr as any).code === '23505')
      if (!refundErr || dup) {
        refundedAmount = debitEntry.debit
      } else {
        console.error('[Rechargekit Finalize] Refund failed:', requestId, refundErr.message)
      }
    }

    return {
      action: 'failed_and_refunded',
      status: 'failed',
      refunded: refundedAmount > 0,
      refundedAmount,
    }
  }

  // ---- Status 2 or other = still pending ----
  await supabaseAdmin.from('bbps_transactions').update({ additional_info: updatedInfo }).eq('id', tx.id)
  return { action: 'still_pending', status: 'pending', refunded: false, refundedAmount: 0 }
}
