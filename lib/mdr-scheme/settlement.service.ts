/**
 * Settlement Service
 * 
 * Handles MDR calculation and settlement processing
 */

import { getSupabaseAdmin } from '@/lib/supabase/server-admin';
import {
  getSchemeForTransaction,
  normalizePaymentMode,
  normalizeCardType,
  normalizeBrandType,
} from './scheme.service';
import type {
  SettlementCalculationInput,
  MDRCalculationResult,
  Transaction,
  CreateTransactionInput,
  SettlementType,
} from '@/types/mdr-scheme.types';
import type { GlobalScheme, RetailerScheme } from '@/types/mdr-scheme.types';

/**
 * Calculate MDR and fees for a transaction
 */
export async function calculateMDR(
  input: SettlementCalculationInput
): Promise<{ success: boolean; result?: MDRCalculationResult; error?: string }> {
  try {
    // Normalize payment details
    const mode = normalizePaymentMode(input.mode);
    const card_type = normalizeCardType(input.card_type || undefined);
    const brand_type = normalizeBrandType(input.brand_type || undefined);

    // Get scheme (retailer scheme first, then global scheme)
    const { scheme, scheme_type } = await getSchemeForTransaction({
      mode,
      card_type,
      brand_type,
      retailer_id: input.retailer_id,
      distributor_id: input.distributor_id || undefined,
    });

    if (!scheme) {
      return {
        success: false,
        error: `No active scheme found for mode: ${mode}, card_type: ${card_type || 'N/A'}, brand_type: ${brand_type || 'N/A'}`,
      };
    }

    // Extract MDR rates based on settlement type
    let retailer_mdr: number;
    let distributor_mdr: number;

    if (scheme_type === 'custom') {
      const customScheme = scheme as RetailerScheme;
      if (input.settlement_type === 'T0') {
        retailer_mdr = customScheme.retailer_mdr_t0;
        distributor_mdr = customScheme.distributor_mdr_t0;
      } else {
        retailer_mdr = customScheme.retailer_mdr_t1;
        distributor_mdr = customScheme.distributor_mdr_t1;
      }
    } else {
      const globalScheme = scheme as GlobalScheme;
      if (input.settlement_type === 'T0') {
        retailer_mdr = globalScheme.rt_mdr_t0;
        distributor_mdr = globalScheme.dt_mdr_t0;
      } else {
        retailer_mdr = globalScheme.rt_mdr_t1;
        distributor_mdr = globalScheme.dt_mdr_t1;
      }
    }

    // Calculate fees (with 4 decimal precision)
    const retailer_fee = Number(
      ((input.amount * retailer_mdr) / 100).toFixed(4)
    );
    const distributor_fee = Number(
      ((input.amount * distributor_mdr) / 100).toFixed(4)
    );

    // Calculate margin and earnings
    const distributor_margin = Number(
      (retailer_fee - distributor_fee).toFixed(4)
    );
    const company_earning = Number(distributor_fee.toFixed(4));

    // Prevent negative margin
    if (distributor_margin < 0) {
      return {
        success: false,
        error: 'Distributor margin cannot be negative. Retailer MDR must be >= Distributor MDR',
      };
    }

    // Calculate retailer settlement amount
    const retailer_settlement_amount = Number(
      (input.amount - retailer_fee).toFixed(2)
    );

    return {
      success: true,
      result: {
        retailer_mdr,
        distributor_mdr,
        retailer_fee,
        distributor_fee,
        distributor_margin,
        company_earning,
        retailer_settlement_amount,
        scheme_type: scheme_type || 'global',
        scheme_id: scheme.id,
      },
    };
  } catch (error: any) {
    console.error('Error calculating MDR:', error);
    return {
      success: false,
      error: error.message || 'Failed to calculate MDR',
    };
  }
}

/**
 * Create transaction record with MDR calculations
 */
export async function createTransaction(
  input: CreateTransactionInput,
  mdrResult: MDRCalculationResult
): Promise<{ success: boolean; data?: Transaction; error?: string }> {
  const supabase = getSupabaseAdmin();

  try {
    // Normalize payment details
    const mode = normalizePaymentMode(input.mode);
    const card_type = normalizeCardType(input.card_type || undefined);
    const brand_type = normalizeBrandType(input.brand_type || undefined);

    const transactionData = {
      razorpay_payment_id: input.razorpay_payment_id,
      amount: input.amount,
      settlement_type: input.settlement_type,
      mode,
      card_type: card_type || null,
      brand_type: brand_type || null,
      retailer_id: input.retailer_id,
      distributor_id: input.distributor_id || null,
      retailer_mdr_used: mdrResult.retailer_mdr,
      distributor_mdr_used: mdrResult.distributor_mdr,
      retailer_fee: mdrResult.retailer_fee,
      distributor_fee: mdrResult.distributor_fee,
      distributor_margin: mdrResult.distributor_margin,
      company_earning: mdrResult.company_earning,
      retailer_settlement_amount: mdrResult.retailer_settlement_amount,
      settlement_status: input.settlement_type === 'T0' ? 'completed' : 'pending',
      retailer_wallet_credited: input.settlement_type === 'T0' ? false : false, // Will be updated after wallet credit
      retailer_wallet_credit_id: null,
      distributor_wallet_credited: false,
      distributor_wallet_credit_id: null,
      admin_wallet_credited: false,
      admin_wallet_credit_id: null,
      scheme_type: mdrResult.scheme_type,
      scheme_id: mdrResult.scheme_id,
      metadata: input.metadata || null,
    };

    const { data, error } = await supabase
      .from('transactions')
      .insert(transactionData)
      .select()
      .single();

    if (error) {
      console.error('Error creating transaction:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data: data as Transaction };
  } catch (error: any) {
    console.error('Error creating transaction:', error);
    return {
      success: false,
      error: error.message || 'Failed to create transaction',
    };
  }
}

/**
 * Credit wallet using Supabase RPC function (atomic operation)
 */
export async function creditWallet(
  user_id: string,
  user_role: 'retailer' | 'distributor' | 'master_distributor',
  amount: number,
  reference_id: string,
  transaction_id: string | null,
  description: string
): Promise<{ success: boolean; wallet_credit_id?: string; error?: string }> {
  const supabase = getSupabaseAdmin();

  try {
    // Use the existing add_ledger_entry RPC function
    const { data: ledgerId, error } = await supabase.rpc('add_ledger_entry', {
      p_user_id: user_id,
      p_user_role: user_role,
      p_wallet_type: 'primary',
      p_fund_category: 'online', // Settlement transactions are online
      p_service_type: 'mdr_settlement',
      p_tx_type: 'SETTLEMENT_CREDIT',
      p_credit: amount,
      p_debit: 0,
      p_reference_id: reference_id,
      p_transaction_id: transaction_id,
      p_status: 'completed',
      p_remarks: description,
    });

    if (error) {
      console.error('Error crediting wallet:', error);
      return { success: false, error: error.message };
    }

    return { success: true, wallet_credit_id: ledgerId };
  } catch (error: any) {
    console.error('Error crediting wallet:', error);
    return {
      success: false,
      error: error.message || 'Failed to credit wallet',
    };
  }
}

/**
 * Process settlement for a transaction
 * Handles wallet credits for retailer, distributor, and admin
 */
export async function processSettlement(
  transaction: Transaction
): Promise<{
  success: boolean;
  retailer_credited?: boolean;
  distributor_credited?: boolean;
  admin_credited?: boolean;
  error?: string;
}> {
  const supabase = getSupabaseAdmin();

  try {
    // Use database transaction with row locking
    // Note: Supabase doesn't support explicit transactions in JS,
    // so we'll use the RPC function which handles atomicity

    let retailer_credited = false;
    let distributor_credited = false;
    let admin_credited = false;

    // 1. Credit retailer wallet (if T+0 or T+1 pending settlement)
    if (
      transaction.settlement_type === 'T0' ||
      (transaction.settlement_type === 'T1' &&
        transaction.settlement_status === 'pending')
    ) {
      if (!transaction.retailer_wallet_credited) {
        const retailerResult = await creditWallet(
          transaction.retailer_id,
          'retailer',
          transaction.retailer_settlement_amount,
          transaction.razorpay_payment_id,
          transaction.id,
          `Settlement Credit - ${transaction.settlement_type} - Amount: ₹${transaction.retailer_settlement_amount}, Fee: ₹${transaction.retailer_fee}`
        );

        if (retailerResult.success && retailerResult.wallet_credit_id) {
          retailer_credited = true;
          // Update transaction record
          await supabase
            .from('transactions')
            .update({
              retailer_wallet_credited: true,
              retailer_wallet_credit_id: retailerResult.wallet_credit_id,
            })
            .eq('id', transaction.id);
        } else {
          return {
            success: false,
            error: `Failed to credit retailer wallet: ${retailerResult.error}`,
          };
        }
      } else {
        retailer_credited = true;
      }
    }

    // 2. Credit distributor wallet (distributor margin)
    if (transaction.distributor_id && !transaction.distributor_wallet_credited) {
      const distributorResult = await creditWallet(
        transaction.distributor_id,
        'distributor',
        transaction.distributor_margin,
        transaction.razorpay_payment_id,
        transaction.id,
        `Distributor Margin - Amount: ₹${transaction.distributor_margin}`
      );

      if (distributorResult.success && distributorResult.wallet_credit_id) {
        distributor_credited = true;
        // Update transaction record
        await supabase
          .from('transactions')
          .update({
            distributor_wallet_credited: true,
            distributor_wallet_credit_id: distributorResult.wallet_credit_id,
          })
          .eq('id', transaction.id);
      } else {
        // Log but don't fail - distributor margin can be processed later
        console.error(
          `Failed to credit distributor wallet: ${distributorResult.error}`
        );
      }
    } else if (transaction.distributor_wallet_credited) {
      distributor_credited = true;
    }

    // 3. Credit admin wallet (company earning)
    // Note: Company earnings can be credited to a master_distributor account
    // or a special admin account. Adjust ADMIN_USER_ID and ADMIN_USER_ROLE as needed.
    if (!transaction.admin_wallet_credited && transaction.company_earning > 0) {
      const adminUserId = process.env.ADMIN_USER_ID || process.env.MASTER_DISTRIBUTOR_ID || null;
      // Map admin role to valid wallet roles (master_distributor is the default for company earnings)
      const adminUserRole: 'retailer' | 'distributor' | 'master_distributor' = 
        (process.env.ADMIN_USER_ROLE as 'retailer' | 'distributor' | 'master_distributor') || 'master_distributor';

      if (adminUserId) {
        const adminResult = await creditWallet(
          adminUserId,
          adminUserRole,
          transaction.company_earning,
          transaction.razorpay_payment_id,
          transaction.id,
          `Company Earning - Amount: ₹${transaction.company_earning}`
        );

        if (adminResult.success && adminResult.wallet_credit_id) {
          admin_credited = true;
          // Update transaction record
          await supabase
            .from('transactions')
            .update({
              admin_wallet_credited: true,
              admin_wallet_credit_id: adminResult.wallet_credit_id,
            })
            .eq('id', transaction.id);
        } else {
          // Log but don't fail - admin earning can be processed later
          console.error(`Failed to credit admin wallet: ${adminResult.error}`);
        }
      } else {
        // Log warning if admin user is not configured
        console.warn('ADMIN_USER_ID or MASTER_DISTRIBUTOR_ID not configured. Company earnings not credited.');
      }
    } else {
      admin_credited = true;
    }

    // Update settlement status if T+0 or T+1 completed
    if (
      transaction.settlement_type === 'T0' ||
      (transaction.settlement_type === 'T1' && retailer_credited)
    ) {
      await supabase
        .from('transactions')
        .update({
          settlement_status: 'completed',
        })
        .eq('id', transaction.id);
    }

    return {
      success: true,
      retailer_credited,
      distributor_credited,
      admin_credited,
    };
  } catch (error: any) {
    console.error('Error processing settlement:', error);
    return {
      success: false,
      error: error.message || 'Failed to process settlement',
    };
  }
}

/**
 * Get pending T+1 transactions for batch settlement
 */
export async function getPendingT1Transactions(
  beforeDate?: Date
): Promise<Transaction[]> {
  const supabase = getSupabaseAdmin();

  // Default to transactions created yesterday or earlier
  const cutoffDate =
    beforeDate || new Date(Date.now() - 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('settlement_type', 'T1')
    .eq('settlement_status', 'pending')
    .lte('created_at', cutoffDate.toISOString())
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching pending T+1 transactions:', error);
    return [];
  }

  return (data || []) as Transaction[];
}

