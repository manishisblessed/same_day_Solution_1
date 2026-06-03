import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUserWithFallback } from '@/lib/auth-server';
import { getAEPSService } from '@/services/aeps';
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger';
import { distributeCommission, mapTransactionTypeToServiceType } from '@/services/aeps/commission';
import { calculateAEPSCommission } from '@/lib/pricing/aeps-pricing';
import { settleAEPSCommission } from '@/services/aeps/settle-commission';
import { formatErrorForReceipt, cleanProviderMessage } from '@/services/aeps/error-codes';
import type { AEPSTransactionType } from '@/types/aeps.types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AEPS_SESSION_HOURS = 24;

function generateIdempotencyKey(prefix: string): string {
  const timestamp = Date.now();
  const random = crypto.randomUUID?.() || `${Math.random().toString(36).substring(2, 15)}`;
  return `${prefix}_${timestamp}_${random}`;
}

function isSessionValid(lastLoginAt: string | null, sessionHours: number): boolean {
  if (!lastLoginAt) return false;
  const loginTime = new Date(lastLoginAt).getTime();
  const now = Date.now();
  return (now - loginTime) < sessionHours * 60 * 60 * 1000;
}

function isValidUtr(utr?: string | null): boolean {
  if (!utr) return false;
  const t = utr.trim();
  return t !== '' && t !== '00' && t !== '0';
}

/**
 * Process AEPS transaction (unified endpoint)
 * POST /api/aeps/transact
 * 
 * Supports: balance_inquiry, cash_withdrawal, cash_deposit, mini_statement
 * 
 * Requirements:
 * - 2FA session must be valid (within 24 hours, same device)
 * - Balance/statement data is returned for display only, never stored in DB
 * - Withdrawal/deposit amounts update the wallet; bank balance is NOT stored
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
      deviceFingerprint,
    } = body;

    if (!merchantId) {
      return NextResponse.json({ error: 'merchantId is required' }, { status: 400 });
    }

    if (!transactionType) {
      return NextResponse.json({ error: 'transactionType is required' }, { status: 400 });
    }

    if (!deviceFingerprint) {
      return NextResponse.json(
        { error: 'deviceFingerprint is required for security verification', code: 'DEVICE_FINGERPRINT_REQUIRED' },
        { status: 400 }
      );
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

    // Look up merchant and validate 2FA session
    let chagansMerchantId = merchantId;
    const { data: merchantRecord } = await supabase
      .from('aeps_merchants')
      .select('merchant_id, last_login_at, device_fingerprint')
      .eq('user_id', user.partner_id)
      .maybeSingle();

    if (!aepsService.isMockMode()) {
      if (!merchantRecord?.merchant_id) {
        return NextResponse.json(
          { error: 'Merchant not registered. Please complete KYC first.' },
          { status: 400 }
        );
      }
      chagansMerchantId = merchantRecord.merchant_id;
    }

    // Enforce 24-hour 2FA session validity
    if (!isSessionValid(merchantRecord?.last_login_at, AEPS_SESSION_HOURS)) {
      return NextResponse.json(
        { error: '2FA session expired. Please re-authenticate.', code: 'SESSION_2FA_EXPIRED' },
        { status: 403 }
      );
    }

    // Enforce device fingerprint check — new device requires re-authentication
    const storedFingerprint = merchantRecord?.device_fingerprint;
    if (!storedFingerprint || deviceFingerprint !== storedFingerprint) {
      return NextResponse.json(
        { error: 'Device changed or not registered. Please re-authenticate.', code: 'DEVICE_CHANGED' },
        { status: 403 }
      );
    }

    console.log('[AEPS Transact] Using Chagans merchantId:', chagansMerchantId);

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

    if (isFinancial && txnAmount <= 0) {
      return NextResponse.json({ error: 'Valid amount is required for financial transactions' }, { status: 400 });
    }

    if (isFinancial && txnAmount > 10000) {
      return NextResponse.json(
        { error: 'Maximum AEPS transaction amount is ₹10,000 (NPCI limit)', code: 'AMOUNT_LIMIT_EXCEEDED' },
        { status: 400 }
      );
    }

    if (isFinancial && txnAmount % 100 !== 0) {
      return NextResponse.json(
        { error: 'Amount must be a multiple of ₹100', code: 'INVALID_AMOUNT' },
        { status: 400 }
      );
    }

    // AEPS wallet balance check — only for deposit/aadhaar_to_aadhaar (retailer pays out)
    // Cash withdrawal credits the wallet, so no pre-funding check is needed.
    const needsWalletDebit = isFinancial && transactionType !== 'cash_withdrawal';
    if (needsWalletDebit) {
      const { data: aepsWalletBalance } = await supabase.rpc('get_wallet_balance_v2', {
        p_user_id: user.partner_id,
        p_wallet_type: 'aeps'
      });

      const walletBal = aepsWalletBalance || 0;
      if (walletBal < txnAmount) {
        return NextResponse.json({
          success: false,
          receipt: {
            txnId: '',
            timestamp: new Date().toISOString(),
            type: transactionType,
            customer: {
              aadhaarMasked: aepsService.maskAadhaar(customerAadhaar),
              bankName: bankName || null,
            },
            transaction: { amount: txnAmount },
            retailer: { id: user.partner_id },
            status: 'FAILED',
            error: {
              errorCode: 'INSUFFICIENT_AEPS_BALANCE',
              errorMessage: 'Insufficient AEPS Wallet Balance',
              action: 'none',
              retryable: false,
            },
          },
          isMockMode: aepsService.isMockMode(),
        });
      }
    }

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

    // Call Chagans AEPS provider — they handle wallet/balance validation
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

    if (result.success) {
      // Per AEPS policy: balance and mini_statement are display-only, never stored.
      await supabase
        .from('aeps_transactions')
        .update({
          status: 'success',
          order_id: result.orderId,
          utr: result.utr,
          rrn: (result as any).rrn || null,
          stan: (result as any).stan || null,
          account_number_masked: result.data?.accountNumber,
          completed_at: new Date().toISOString()
        })
        .eq('id', aepsTransaction.id);

      // Update AEPS wallet for financial transactions
      // Withdrawal: credit retailer wallet (bank debits customer, retailer receives funds)
      // Deposit/A2A: debit retailer wallet (retailer pays out to customer's bank)
      if (isFinancial && txnAmount > 0) {
        const isWithdrawal = transactionType === 'cash_withdrawal';
        try {
          const { data: walletLedgerId, error: walletError } = await supabase.rpc('add_ledger_entry', {
            p_user_id: user.partner_id,
            p_user_role: user.role,
            p_wallet_type: 'aeps',
            p_fund_category: 'aeps',
            p_service_type: 'aeps',
            p_tx_type: isWithdrawal ? 'AEPS_CREDIT' : 'AEPS_DEBIT',
            p_credit: isWithdrawal ? txnAmount : 0,
            p_debit: isWithdrawal ? 0 : txnAmount,
            p_reference_id: result.orderId || aepsTransaction.id,
            p_transaction_id: aepsTransaction.id,
            p_status: 'completed',
            p_remarks: `AEPS ${transactionType} - ₹${txnAmount}`,
          });

          if (!walletError && walletLedgerId) {
            const walletUpdate: Record<string, any> = isWithdrawal
              ? { wallet_credited: true, wallet_credit_id: walletLedgerId }
              : { wallet_debited: true, wallet_debit_id: walletLedgerId };
            await supabase
              .from('aeps_transactions')
              .update(walletUpdate)
              .eq('id', aepsTransaction.id);
          } else {
            console.error(`[AEPS Transact] Wallet ${isWithdrawal ? 'credit' : 'debit'} failed:`, walletError);
          }
        } catch (walletErr) {
          console.error(`[AEPS Transact] Wallet ${isWithdrawal ? 'credit' : 'debit'} error:`, walletErr);
        }
      }

      // Commission distribution (only on successful financial txns + mini_statement)
      let commissionResult: any = null;
      let rtCommissionForReceipt: number | null = null;
      let rtCommissionGross: number | null = null;
      let rtTdsPercentage: number | null = null;
      let rtTdsAmount: number | null = null;
      const commissionEnabled = process.env.AEPS_COMMISSION_ENABLED !== 'false'; // Default: enabled
      const eligibleForCommission = (isFinancial || transactionType === 'mini_statement') && commissionEnabled;

      if (eligibleForCommission) {
        // Look up retailer's hierarchy (DT and MD)
        const { data: retailerInfo } = await supabase
          .from('retailers')
          .select('distributor_id, master_distributor_id')
          .eq('user_id', user.partner_id)
          .maybeSingle();

        const dtUserId = retailerInfo?.distributor_id || undefined;
        const mdUserId = retailerInfo?.master_distributor_id || undefined;

        // Scheme engine is now the primary commission engine
        let schemeHandled = false;
        try {
          const breakdown = await calculateAEPSCommission({
            userId: user.partner_id,
            userRole: user.role,
            transactionType,
            amount: txnAmount || 0,
            distributorId: dtUserId,
            mdId: mdUserId,
          });

          if (breakdown && (breakdown.retailer_net > 0 || breakdown.distributor_net > 0 || breakdown.md_net > 0)) {
            const settle = await settleAEPSCommission({
              transactionId: aepsTransaction.id,
              transactionType,
              amount: txnAmount || 0,
              rtUserId: user.partner_id,
              dtUserId,
              mdUserId,
              breakdown,
            });
            commissionResult = settle;
            rtCommissionForReceipt = breakdown.retailer_net;
            rtCommissionGross = breakdown.retailer_commission;
            rtTdsPercentage = breakdown.tds_percentage;
            rtTdsAmount = breakdown.retailer_commission > 0
              ? Math.round((breakdown.retailer_commission - breakdown.retailer_net) * 100) / 100
              : 0;
            schemeHandled = true;

            if (settle.success && settle.commissionId) {
              await supabase
                .from('aeps_transactions')
                .update({ commission_id: settle.commissionId })
                .eq('id', aepsTransaction.id);
            }
            console.log(`[AEPS Transact] Scheme commission: RT=₹${breakdown.retailer_net} DT=₹${breakdown.distributor_net} MD=₹${breakdown.md_net} (scheme: ${breakdown.scheme_name})`);
          } else {
            console.warn('[AEPS Transact] Scheme engine returned no commission, falling back to legacy');
          }
        } catch (schemeErr) {
          console.warn('[AEPS Transact] Scheme engine error, falling back to legacy:', schemeErr);
        }

        // Fallback: legacy percentage-split engine (service_slabs + commission_distribution)
        if (!schemeHandled) {
          const serviceType = mapTransactionTypeToServiceType(transactionType);
          commissionResult = await distributeCommission({
            transactionId: aepsTransaction.id,
            serviceType,
            amount: txnAmount || 0,
            rtUserId: user.partner_id,
            dtUserId,
            mdUserId,
          });
          rtCommissionForReceipt = commissionResult?.breakdown?.rtAmount ?? null;

          if (commissionResult.success && commissionResult.commissionId) {
            await supabase
              .from('aeps_transactions')
              .update({ commission_id: commissionResult.commissionId })
              .eq('id', aepsTransaction.id);
          }
          console.log(`[AEPS Transact] Legacy commission: RT=₹${rtCommissionForReceipt ?? 0}`);
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

      // Get merchant details for receipt
      const { data: merchantDetails } = await supabase
        .from('aeps_merchants')
        .select('name, address_city')
        .eq('user_id', user.partner_id)
        .maybeSingle();

      return NextResponse.json({
        success: true,
        receipt: {
          txnId: aepsTransaction.id,
          orderId: result.orderId || null,
          utr: isValidUtr(result.utr) ? result.utr : (result.orderId || null),
          rrn: (result as any).rrn || null,
          stan: (result as any).stan || null,
          timestamp: new Date().toISOString(),
          type: transactionType,
          customer: {
            aadhaarMasked: aepsService.maskAadhaar(customerAadhaar),
            bankName: bankName || null,
            accountNumberMasked: result.data?.accountNumber || null,
          },
          transaction: {
            amount: isFinancial ? txnAmount : null,
            commission: rtCommissionForReceipt,
            commissionGross: rtCommissionGross,
            tdsPercentage: rtTdsPercentage,
            tdsAmount: rtTdsAmount,
          },
          bank: {
            availableBalance: result.data?.balance || null,
          },
          miniStatement: transactionType === 'mini_statement'
            ? (result.data?.miniStatement || []).slice(0, 10)
            : null,
          retailer: {
            id: user.partner_id,
            name: merchantDetails?.name || user.email,
            location: merchantDetails?.address_city || null,
          },
          status: 'SUCCESS',
        },
        isMockMode: aepsService.isMockMode(),
      });
    } else {
      // Format error using NPCI code mapping
      const errorInfo = formatErrorForReceipt(
        result.message || result.error || 'Transaction failed',
        (result as any).npciCode || result.error
      );

      await supabase
        .from('aeps_transactions')
        .update({
          status: 'failed',
          error_message: errorInfo.errorMessage,
          completed_at: new Date().toISOString()
        })
        .eq('id', aepsTransaction.id);

      // Log activity
      const ctx = getRequestContext(request);
      logActivityFromContext(ctx, user, {
        activity_type: 'aeps_transaction',
        activity_category: 'aeps',
        activity_description: `AEPS ${transactionType} FAILED: ${errorInfo.errorCode}`,
        reference_id: aepsTransaction.id,
        reference_table: 'aeps_transactions',
        metadata: { transactionType, amount: txnAmount, errorCode: errorInfo.errorCode },
      }).catch(() => {});

      return NextResponse.json({
        success: false,
        receipt: {
          txnId: aepsTransaction.id,
          orderId: result.orderId || null,
          timestamp: new Date().toISOString(),
          type: transactionType,
          customer: {
            aadhaarMasked: aepsService.maskAadhaar(customerAadhaar),
            bankName: bankName || null,
          },
          transaction: {
            amount: isFinancial ? txnAmount : null,
          },
          retailer: {
            id: user.partner_id,
          },
          status: 'FAILED',
          error: errorInfo,
        },
        isMockMode: aepsService.isMockMode(),
      });
    }
  } catch (error: any) {
    console.error('[AEPS Transact] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process transaction' },
      { status: 500 }
    );
  }
}
