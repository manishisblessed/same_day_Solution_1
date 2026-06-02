/**
 * API: POST /api/aeps/settlement
 * 
 * Auto-settles AEPS wallet balance to retailer's bank account via Spark Up.
 * No admin approval required — if balance is sufficient, payout is initiated immediately.
 * 
 * Flow:
 *   1. Resolve settlement charge via scheme engine (aeps_settlement)
 *   2. Verify AEPS wallet balance >= amount + charge
 *   3. Debit AEPS wallet (amount + charge)
 *   4. Initiate payout via Spark Up Express Pay
 *   5. On failure → auto-refund AEPS wallet
 *   6. Distribute charge margins (company/MD/DT)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUserWithFallback } from '@/lib/auth-server';
import { initiateTransfer } from '@/services/payout/transfer';
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger';
import { calculateAEPSSettlementCharge } from '@/lib/scheme/scheme.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function generateIdempotencyKey(prefix: string): string {
  const timestamp = Date.now();
  const random = crypto.randomUUID?.() || `${Math.random().toString(36).substring(2, 15)}`;
  return `${prefix}_${timestamp}_${random}`;
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Database configuration missing' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { user, method } = await getCurrentUserWithFallback(request);
    if (!user || !user.partner_id) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 });
    }

    if (!['retailer', 'distributor', 'master_distributor'].includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden: Invalid user role' }, { status: 403 });
    }

    const body = await request.json();
    const { amount, settlement_account_id } = body;

    if (!amount || !settlement_account_id) {
      return NextResponse.json(
        { error: 'amount and settlement_account_id are required' },
        { status: 400 }
      );
    }

    const amountDecimal = parseFloat(amount);
    if (isNaN(amountDecimal) || amountDecimal <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    if (amountDecimal < 1001) {
      return NextResponse.json({
        error: 'Minimum AEPS settlement amount is ₹1,001. Please enter a higher amount.',
        min_amount: 1001,
      }, { status: 400 });
    }

    // Step 6: Only allow settlement to admin-approved accounts
    const { data: settleAccount, error: acctErr } = await supabase
      .from('aeps_settlement_accounts')
      .select('*')
      .eq('id', settlement_account_id)
      .eq('user_id', user.partner_id)
      .single();

    if (acctErr || !settleAccount) {
      return NextResponse.json({ error: 'Settlement account not found' }, { status: 404 });
    }

    if (settleAccount.admin_status !== 'approved') {
      return NextResponse.json({
        error: `Settlement account is ${settleAccount.admin_status}. Only admin-approved accounts can be used.`,
        admin_status: settleAccount.admin_status,
      }, { status: 403 });
    }

    if (settleAccount.verification_status !== 'verified') {
      return NextResponse.json({ error: 'Settlement account is not verified' }, { status: 403 });
    }

    const bank_account_number = settleAccount.account_number;
    const bank_ifsc = settleAccount.ifsc_code;
    const bank_account_name = settleAccount.account_holder_name;

    // Check for existing pending AEPS settlement
    const { data: existingSettlement } = await supabase
      .from('aeps_settlements')
      .select('id, status, amount')
      .eq('user_id', user.partner_id)
      .in('status', ['pending', 'processing'])
      .limit(1)
      .maybeSingle();

    if (existingSettlement) {
      return NextResponse.json({
        error: 'An AEPS settlement is already in progress',
        existing_settlement_id: existingSettlement.id,
        message: 'Please wait for the current settlement to complete.'
      }, { status: 409 });
    }

    // Check AEPS wallet frozen/held status
    const { data: wallet } = await supabase
      .from('wallets')
      .select('is_frozen, is_settlement_held')
      .eq('user_id', user.partner_id)
      .eq('wallet_type', 'aeps')
      .maybeSingle();

    if (wallet?.is_frozen) {
      return NextResponse.json({ error: 'AEPS wallet is frozen. Cannot create settlement.' }, { status: 403 });
    }

    // Resolve settlement charge via scheme engine
    let distributorId: string | undefined;
    let mdId: string | undefined;

    if (user.role === 'retailer') {
      const { data: retailer } = await supabase
        .from('retailers')
        .select('distributor_id, master_distributor_id')
        .eq('partner_id', user.partner_id)
        .maybeSingle();
      distributorId = retailer?.distributor_id || undefined;
      mdId = retailer?.master_distributor_id || undefined;
    } else if (user.role === 'distributor') {
      const { data: dist } = await supabase
        .from('distributors')
        .select('master_distributor_id')
        .eq('partner_id', user.partner_id)
        .maybeSingle();
      mdId = dist?.master_distributor_id || undefined;
    }

    const chargeBreakdown = await calculateAEPSSettlementCharge(
      user.partner_id, user.role, amountDecimal, distributorId, mdId
    );

    const charge = chargeBreakdown?.retailer_charge ?? 0;
    const totalDebit = amountDecimal + charge;

    // Check AEPS wallet balance
    const { data: aepsBalance } = await supabase.rpc('get_wallet_balance_v2', {
      p_user_id: user.partner_id,
      p_wallet_type: 'aeps',
    });

    if ((aepsBalance || 0) < totalDebit) {
      return NextResponse.json({
        error: 'Insufficient AEPS wallet balance',
        available_balance: aepsBalance || 0,
        required_amount: totalDebit,
        transfer_amount: amountDecimal,
        charge,
      }, { status: 400 });
    }

    const idempotencyKey = generateIdempotencyKey(`AEPS_SETTLE_${user.partner_id}`);

    // Create AEPS settlement record
    const { data: settlement, error: settleErr } = await supabase
      .from('aeps_settlements')
      .insert({
        user_id: user.partner_id,
        user_role: user.role,
        amount: amountDecimal,
        charge,
        net_amount: amountDecimal,
        bank_account_number,
        bank_ifsc,
        bank_account_name,
        status: 'pending',
        idempotency_key: idempotencyKey,
        scheme_id: chargeBreakdown?.scheme_id || null,
        charge_breakdown: chargeBreakdown ? {
          retailer_charge: chargeBreakdown.retailer_charge,
          distributor_commission: chargeBreakdown.distributor_commission,
          md_commission: chargeBreakdown.md_commission,
          company_earning: chargeBreakdown.company_earning,
          scheme_name: chargeBreakdown.scheme_name,
          resolved_via: chargeBreakdown.resolved_via,
        } : null,
      })
      .select()
      .single();

    if (settleErr || !settlement) {
      console.error('[AEPS Settlement] DB insert failed:', settleErr);
      return NextResponse.json({ error: 'Failed to create settlement record' }, { status: 500 });
    }

    // Debit AEPS wallet (amount + charge)
    const { data: ledgerId, error: ledgerErr } = await supabase.rpc('add_ledger_entry', {
      p_user_id: user.partner_id,
      p_user_role: user.role,
      p_wallet_type: 'aeps',
      p_fund_category: 'settlement',
      p_service_type: 'aeps',
      p_tx_type: 'AEPS_SETTLEMENT',
      p_credit: 0,
      p_debit: totalDebit,
      p_reference_id: idempotencyKey,
      p_transaction_id: settlement.id,
      p_status: 'pending',
      p_remarks: `AEPS Settlement - Amount: ₹${amountDecimal}, Charge: ₹${charge}`,
    });

    if (ledgerErr) {
      console.error('[AEPS Settlement] Wallet debit failed:', ledgerErr);
      await supabase.from('aeps_settlements').update({ status: 'failed', failure_reason: 'Wallet debit failed' }).eq('id', settlement.id);
      return NextResponse.json({ error: 'Failed to debit AEPS wallet' }, { status: 500 });
    }

    await supabase.from('aeps_settlements').update({ ledger_entry_id: ledgerId, status: 'processing' }).eq('id', settlement.id);

    // Get user details for Spark Up transfer
    let senderMobile = '9999999999';
    let senderEmail = user.email || 'noreply@samedaysolution.in';
    let senderName = bank_account_name;

    try {
      const roleTable = user.role === 'retailer' ? 'retailers' : user.role === 'distributor' ? 'distributors' : 'master_distributors';
      const { data: userInfo } = await supabase
        .from(roleTable)
        .select('mobile, name')
        .eq('partner_id', user.partner_id)
        .maybeSingle();
      if (userInfo?.mobile) senderMobile = userInfo.mobile;
      if (userInfo?.name) senderName = userInfo.name;
    } catch {}

    // Initiate transfer via Spark Up
    const clientRefId = `AEPS_SETTLE_${settlement.id}_${Date.now()}`;
    const transferResult = await initiateTransfer({
      accountNumber: bank_account_number,
      ifscCode: bank_ifsc,
      accountHolderName: bank_account_name,
      amount: amountDecimal,
      transferMode: 'IMPS',
      beneficiaryMobile: senderMobile,
      senderName,
      senderMobile,
      senderEmail,
      remarks: `AEPS Settlement - ${bank_account_name} (ID: ${settlement.id})`,
      clientRefId,
    });

    // Handle timeout — keep as processing, don't refund
    if (transferResult.is_timeout) {
      await supabase.from('aeps_settlements').update({ status: 'processing' }).eq('id', settlement.id);
      if (ledgerId) {
        await supabase.from('wallet_ledger').update({ status: 'completed' }).eq('id', ledgerId);
      }

      const ctx = getRequestContext(request);
      logActivityFromContext(ctx, user, {
        activity_type: 'aeps_settlement',
        activity_category: 'aeps',
        activity_description: `AEPS settlement ₹${amountDecimal} processing (timeout)`,
        reference_id: settlement.id,
        reference_table: 'aeps_settlements',
      }).catch(() => {});

      return NextResponse.json({
        success: true,
        settlement_id: settlement.id,
        amount: amountDecimal,
        charge,
        net_amount: amountDecimal,
        status: 'processing',
        message: 'Settlement is being processed. Please check status in a few minutes.',
      });
    }

    if (transferResult.success && transferResult.transaction_id) {
      const payoutStatus = transferResult.status || 'processing';
      await supabase.from('aeps_settlements').update({
        status: payoutStatus === 'success' ? 'success' : 'processing',
        payout_reference_id: transferResult.transaction_id,
        completed_at: payoutStatus === 'success' ? new Date().toISOString() : null,
      }).eq('id', settlement.id);

      if (ledgerId) {
        await supabase.from('wallet_ledger').update({
          status: payoutStatus === 'success' ? 'completed' : 'pending',
          reference_id: transferResult.transaction_id,
        }).eq('id', ledgerId);
      }

      // Distribute charge margins to DT/MD/Company wallets
      if (chargeBreakdown && charge > 0) {
        if (distributorId && chargeBreakdown.distributor_commission > 0) {
          await supabase.rpc('add_ledger_entry', {
            p_user_id: distributorId,
            p_user_role: 'distributor',
            p_wallet_type: 'primary',
            p_fund_category: 'commission',
            p_service_type: 'aeps',
            p_tx_type: 'AEPS_SETTLE_MARGIN',
            p_credit: chargeBreakdown.distributor_commission,
            p_debit: 0,
            p_reference_id: `AEPS_SETTLE_MARGIN_DT_${settlement.id}`,
            p_transaction_id: settlement.id,
            p_status: 'completed',
            p_remarks: `AEPS settlement DT margin: ₹${chargeBreakdown.distributor_commission}`,
          });
        }
        if (mdId && chargeBreakdown.md_commission > 0) {
          await supabase.rpc('add_ledger_entry', {
            p_user_id: mdId,
            p_user_role: 'master_distributor',
            p_wallet_type: 'primary',
            p_fund_category: 'commission',
            p_service_type: 'aeps',
            p_tx_type: 'AEPS_SETTLE_MARGIN',
            p_credit: chargeBreakdown.md_commission,
            p_debit: 0,
            p_reference_id: `AEPS_SETTLE_MARGIN_MD_${settlement.id}`,
            p_transaction_id: settlement.id,
            p_status: 'completed',
            p_remarks: `AEPS settlement MD margin: ₹${chargeBreakdown.md_commission}`,
          });
        }
      }

      const ctx = getRequestContext(request);
      logActivityFromContext(ctx, user, {
        activity_type: 'aeps_settlement',
        activity_category: 'aeps',
        activity_description: `AEPS settlement ₹${amountDecimal} ${payoutStatus}`,
        reference_id: settlement.id,
        reference_table: 'aeps_settlements',
        metadata: { amount: amountDecimal, charge, payout_reference_id: transferResult.transaction_id },
      }).catch(() => {});

      return NextResponse.json({
        success: true,
        settlement_id: settlement.id,
        amount: amountDecimal,
        charge,
        net_amount: amountDecimal,
        status: payoutStatus,
        payout_reference_id: transferResult.transaction_id,
        message: payoutStatus === 'success'
          ? 'Settlement processed successfully'
          : 'Settlement initiated. Payout is being processed.',
      });
    } else {
      // Payout failed — refund AEPS wallet
      const failureReason = transferResult.error || 'Payout API failed';

      const { error: refundErr } = await supabase.rpc('add_ledger_entry', {
        p_user_id: user.partner_id,
        p_user_role: user.role,
        p_wallet_type: 'aeps',
        p_fund_category: 'settlement',
        p_service_type: 'aeps',
        p_tx_type: 'REFUND',
        p_credit: totalDebit,
        p_debit: 0,
        p_reference_id: `AEPS_SETTLE_REFUND_${settlement.id}`,
        p_transaction_id: settlement.id,
        p_status: 'completed',
        p_remarks: `AEPS settlement failed - Automatic refund. Reason: ${failureReason}`,
      });

      await supabase.from('aeps_settlements').update({
        status: 'failed',
        failure_reason: `${failureReason} [${refundErr ? 'REFUND_FAILED' : 'Wallet refunded'}]`,
      }).eq('id', settlement.id);

      if (refundErr) {
        console.error('[AEPS Settlement] CRITICAL: Refund failed:', refundErr);
      }

      return NextResponse.json({
        error: 'Settlement payout failed',
        details: failureReason,
        wallet_refunded: !refundErr,
        settlement_id: settlement.id,
      }, { status: 500 });
    }
  } catch (error: any) {
    console.error('[AEPS Settlement] Error:', error);
    return NextResponse.json({ error: error.message || 'Failed to process AEPS settlement' }, { status: 500 });
  }
}
