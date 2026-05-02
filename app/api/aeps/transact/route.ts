import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUserWithFallback } from '@/lib/auth-server';
import { getAEPSService } from '@/services/aeps';
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger';
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
    if (deviceFingerprint && merchantRecord?.device_fingerprint &&
        deviceFingerprint !== merchantRecord.device_fingerprint) {
      return NextResponse.json(
        { error: 'Device changed. Please re-authenticate from this device.', code: 'DEVICE_CHANGED' },
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

    // No internal wallet checks — the Chagans provider manages the merchant's
    // AEPS float/wallet and validates balance on their side.

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
          account_number_masked: result.data?.accountNumber,
          completed_at: new Date().toISOString()
        })
        .eq('id', aepsTransaction.id);
    } else {
      await supabase
        .from('aeps_transactions')
        .update({
          status: 'failed',
          error_message: result.message || result.error,
          completed_at: new Date().toISOString()
        })
        .eq('id', aepsTransaction.id);
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

    return NextResponse.json({
      success: result.success,
      transactionId: aepsTransaction.id,
      orderId: result.orderId,
      utr: result.utr,
      status: result.status,
      message: result.message,
      data: result.data,
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
