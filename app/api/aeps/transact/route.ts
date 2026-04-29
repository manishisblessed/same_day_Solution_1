import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUserWithFallback } from '@/lib/auth-server';
import { getAEPSService } from '@/services/aeps';
import { checkAllLimits } from '@/lib/limits/enforcement';
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger';
import type { AEPSTransactionType } from '@/types/aeps.types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function generateIdempotencyKey(prefix: string): string {
  const timestamp = Date.now();
  const random = crypto.randomUUID?.() || `${Math.random().toString(36).substring(2, 15)}`;
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Process AEPS transaction (unified endpoint)
 * POST /api/aeps/transact
 * 
 * Supports: balance_inquiry, cash_withdrawal, cash_deposit, mini_statement
 */
export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: 'Database configuration missing' },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { user, method } = await getCurrentUserWithFallback(request);
    console.log('[AEPS Transact] Auth:', method, '|', user?.email || 'none');

    if (!user || !user.partner_id) {
      return NextResponse.json(
        { error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      );
    }

    // Only retailers, distributors, and master distributors can perform AEPS transactions
    if (!['retailer', 'distributor', 'master_distributor'].includes(user.role)) {
      return NextResponse.json(
        { error: 'Forbidden: Invalid user role' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      merchantId,
      transactionType,
      amount,
      customerAadhaar,
      customerMobile,
      bankIin,
      bankName,
      biometricData,
      wadh,
    } = body;

    // Validation
    if (!merchantId) {
      return NextResponse.json({ error: 'merchantId is required' }, { status: 400 });
    }

    if (!transactionType) {
      return NextResponse.json({ error: 'transactionType is required' }, { status: 400 });
    }

    const validTypes: AEPSTransactionType[] = [
      'balance_inquiry', 'cash_withdrawal', 'cash_deposit', 'mini_statement', 'aadhaar_to_aadhaar'
    ];
    if (!validTypes.includes(transactionType)) {
      return NextResponse.json({ error: 'Invalid transactionType' }, { status: 400 });
    }

    if (!customerAadhaar) {
      return NextResponse.json({ error: 'customerAadhaar is required' }, { status: 400 });
    }

    if (!customerMobile) {
      return NextResponse.json({ error: 'customerMobile is required' }, { status: 400 });
    }

    if (!bankIin) {
      return NextResponse.json({ error: 'bankIin is required' }, { status: 400 });
    }

    const aepsService = getAEPSService();

    // Look up the real Chagans merchantId from our database
    let chagansMerchantId = merchantId;
    if (!aepsService.isMockMode()) {
      const { data: merchantRecord } = await supabase
        .from('aeps_merchants')
        .select('merchant_id')
        .eq('user_id', user.partner_id)
        .maybeSingle();

      if (!merchantRecord?.merchant_id) {
        return NextResponse.json(
          { error: 'Merchant not registered. Please complete KYC first.' },
          { status: 400 }
        );
      }
      chagansMerchantId = merchantRecord.merchant_id;
      console.log('[AEPS Transact] Using Chagans merchantId:', chagansMerchantId);
    }

    // Validate inputs
    const aadhaarValidation = aepsService.validateAadhaarNumber(customerAadhaar);
    if (!aadhaarValidation.valid) {
      console.log('[AEPS Transact] Aadhaar validation failed:', aadhaarValidation.error, '| input:', customerAadhaar?.substring(0, 4) + '****');
      return NextResponse.json({ error: aadhaarValidation.error }, { status: 400 });
    }

    const mobileValidation = aepsService.validateMobileNumber(customerMobile);
    if (!mobileValidation.valid) {
      return NextResponse.json({ error: mobileValidation.error }, { status: 400 });
    }

    const isFinancial = ['cash_withdrawal', 'cash_deposit', 'aadhaar_to_aadhaar'].includes(transactionType);
    const txnAmount = isFinancial ? parseFloat(amount) || 0 : 0;

    // For financial transactions, validate amount
    if (isFinancial && txnAmount <= 0) {
      return NextResponse.json({ error: 'Valid amount is required for financial transactions' }, { status: 400 });
    }

    // Check wallet if financial withdrawal
    if (transactionType === 'cash_withdrawal') {
      // Check if AEPS wallet is frozen
      const { data: wallet } = await supabase
        .from('wallets')
        .select('is_frozen, balance')
        .eq('user_id', user.partner_id)
        .eq('wallet_type', 'aeps')
        .single();

      if (wallet?.is_frozen) {
        return NextResponse.json(
          { error: 'AEPS wallet is frozen. Cannot process transaction.' },
          { status: 403 }
        );
      }

      // Check limits
      const limitCheck = await checkAllLimits(
        user.partner_id,
        user.role,
        'aeps',
        txnAmount,
        'aeps'
      );

      if (!limitCheck.allowed) {
        return NextResponse.json(
          { error: limitCheck.reason || 'Transaction limit exceeded' },
          { status: 403 }
        );
      }

      // Check balance
      const { data: balance } = await supabase.rpc('get_wallet_balance_v2', {
        p_user_id: user.partner_id,
        p_wallet_type: 'aeps'
      });

      if ((balance || 0) < txnAmount) {
        return NextResponse.json(
          {
            error: 'Insufficient AEPS wallet balance',
            available_balance: balance || 0,
            required_amount: txnAmount
          },
          { status: 400 }
        );
      }
    }

    // Generate idempotency key
    const idempotencyKey = generateIdempotencyKey(`AEPS_${user.partner_id}`);

    // Create AEPS transaction record (pending)
    const { data: aepsTransaction, error: txError } = await supabase
      .from('aeps_transactions')
      .insert({
        user_id: user.partner_id,
        user_role: user.role,
        merchant_id: merchantId,
        transaction_type: transactionType,
        is_financial: isFinancial,
        amount: isFinancial ? txnAmount : null,
        aadhaar_number_masked: aepsService.maskAadhaar(customerAadhaar),
        bank_iin: bankIin,
        bank_name: bankName || null,
        status: 'pending',
        idempotency_key: idempotencyKey
      })
      .select()
      .single();

    if (txError || !aepsTransaction) {
      console.error('[AEPS Transact] DB Error:', txError);
      return NextResponse.json(
        { error: 'Failed to create transaction record' },
        { status: 500 }
      );
    }

    // Debit wallet for withdrawal (before calling API)
    let ledgerId: string | null = null;
    if (transactionType === 'cash_withdrawal') {
      const { data: debitLedgerId, error: debitError } = await supabase.rpc('add_ledger_entry', {
        p_user_id: user.partner_id,
        p_user_role: user.role,
        p_wallet_type: 'aeps',
        p_fund_category: 'aeps',
        p_service_type: 'aeps',
        p_tx_type: 'AEPS_DEBIT',
        p_credit: 0,
        p_debit: txnAmount,
        p_reference_id: idempotencyKey,
        p_transaction_id: aepsTransaction.id,
        p_status: 'pending',
        p_remarks: `AEPS ${transactionType} - Amount: ₹${txnAmount}`
      });

      if (debitError) {
        console.error('[AEPS Transact] Wallet debit error:', debitError);
        await supabase
          .from('aeps_transactions')
          .update({ status: 'failed', error_message: 'Failed to debit wallet' })
          .eq('id', aepsTransaction.id);

        return NextResponse.json(
          { error: 'Failed to debit wallet' },
          { status: 500 }
        );
      }

      ledgerId = debitLedgerId;
      await supabase
        .from('aeps_transactions')
        .update({ wallet_debited: true, wallet_debit_id: ledgerId })
        .eq('id', aepsTransaction.id);
    }

    // Process transaction via AEPS service (use Chagans merchantId for real API)
    const result = await aepsService.processTransaction({
      userId: user.partner_id,
      userRole: user.role,
      merchantId: chagansMerchantId,
      transactionType,
      amount: txnAmount,
      customerAadhaar,
      customerMobile,
      bankIin,
      bankName,
      wadh,
      biometricData,
    });

    // Update transaction based on result
    if (result.success) {
      await supabase
        .from('aeps_transactions')
        .update({
          status: 'success',
          order_id: result.orderId,
          utr: result.utr,
          account_number_masked: result.data?.accountNumber,
          balance_after: result.data?.balance ? parseFloat(result.data.balance) : null,
          mini_statement: result.data?.miniStatement || null,
          completed_at: new Date().toISOString()
        })
        .eq('id', aepsTransaction.id);

      // Complete ledger entry
      if (ledgerId) {
        await supabase
          .from('wallet_ledger')
          .update({ status: 'completed' })
          .eq('id', ledgerId);
      }
    } else {
      // Transaction failed
      await supabase
        .from('aeps_transactions')
        .update({
          status: 'failed',
          error_message: result.message || result.error,
          completed_at: new Date().toISOString()
        })
        .eq('id', aepsTransaction.id);

      // Reverse wallet debit if withdrawal failed
      if (ledgerId && transactionType === 'cash_withdrawal') {
        await supabase.rpc('add_ledger_entry', {
          p_user_id: user.partner_id,
          p_user_role: user.role,
          p_wallet_type: 'aeps',
          p_fund_category: 'aeps',
          p_service_type: 'aeps',
          p_tx_type: 'AEPS_REFUND',
          p_credit: txnAmount,
          p_debit: 0,
          p_reference_id: `REVERSAL_${idempotencyKey}`,
          p_transaction_id: aepsTransaction.id,
          p_status: 'completed',
          p_remarks: `AEPS transaction failed - Reversal`
        });

        await supabase
          .from('wallet_ledger')
          .update({ status: 'reversed' })
          .eq('id', ledgerId);
      }
    }

    // Log activity
    const ctx = getRequestContext(request);
    logActivityFromContext(ctx, user, {
      activity_type: 'aeps_transaction',
      activity_category: 'aeps',
      activity_description: `AEPS ${transactionType} for ₹${txnAmount || 0}`,
      reference_id: aepsTransaction.id,
      reference_table: 'aeps_transactions',
      metadata: { transactionType, amount: txnAmount, orderId: result.orderId },
    }).catch(() => {});

    // Get updated wallet balance
    const { data: newBalance } = await supabase.rpc('get_wallet_balance_v2', {
      p_user_id: user.partner_id,
      p_wallet_type: 'aeps'
    });

    return NextResponse.json({
      success: result.success,
      transactionId: aepsTransaction.id,
      orderId: result.orderId,
      utr: result.utr,
      status: result.status,
      message: result.message,
      data: result.data,
      walletBalance: newBalance || 0,
      isMockMode: aepsService.isMockMode(),
    });
  } catch (error: any) {
    console.error('[AEPS Transact] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process transaction' },
      { status: 500 }
    );
  }
}
