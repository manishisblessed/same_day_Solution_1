import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUserWithFallback } from '@/lib/auth-server';
import { authorizeSubPartner, normalizeMasterPartner } from '@/lib/partner-access';
import { isAEPSProviderPay2New } from '@/services/aeps/config';
import { createPay2NewAepsClient } from '@/services/pay2new-aeps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Pay2New AEPS Transaction OTP
 * POST /api/aeps/transaction-otp
 *
 * Required for cash withdrawals above ₹5,000.
 * Flow:
 *   1. Call this endpoint → customer receives OTP on phone
 *   2. Customer enters OTP into the RD service biometric capture (Opts otp="...")
 *   3. Submit the resulting capture + referenceKey with /api/aeps/transact
 *
 * Only available when AEPS_PROVIDER=pay2new.
 */
export async function POST(request: NextRequest) {
  if (!isAEPSProviderPay2New()) {
    return NextResponse.json(
      { error: 'Transaction OTP is only available when AEPS_PROVIDER=pay2new' },
      { status: 404 },
    );
  }

  try {
    const { user, method } = await getCurrentUserWithFallback(request);
    console.log('[AEPS TxnOTP] Auth:', method, '|', user?.email || 'none');
    normalizeMasterPartner(user);

    const access = authorizeSubPartner(user, 'aeps');
    if (!access.ok) return access.response;

    if (!user?.partner_id) {
      return NextResponse.json({ error: 'Session expired.', code: 'SESSION_EXPIRED' }, { status: 401 });
    }

    const body = await request.json();
    const {
      amount,
      bankiin,
      customerMobile,
      latitude,
      longitude,
      customerAadhaar,
      // RD biometric fields (aadhaar_number only needed here — full capture for withdrawal)
      dc, ci, hmac, dpId, mc, pidDataType, mi,
      rdsId, sessionKey, fCount, errCode, pCount,
      fType, iCount, pType, srno, pidData, qScore,
      nmPoints, rdsVer,
    } = body;

    if (!amount || !bankiin || !customerMobile) {
      return NextResponse.json(
        { error: 'amount, bankiin and customerMobile are required' },
        { status: 400 },
      );
    }

    if (!customerAadhaar || !/^\d{12}$/.test(customerAadhaar)) {
      return NextResponse.json({ error: 'customerAadhaar (12 digits) is required' }, { status: 400 });
    }

    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || '127.0.0.1';

    const defaultLat = process.env.PAY2NEW_LATITUDE || '19.1258';
    const defaultLng = process.env.PAY2NEW_LONGITUDE || '74.7453';
    const productCode = process.env.PAY2NEW_AEPS_PRODUCT_CODE || '243';

    // Use per-merchant outletId from DB
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: merchantRec } = await supabase
      .from('aeps_merchants')
      .select('merchant_id')
      .eq('user_id', user.partner_id)
      .maybeSingle();
    const client = createPay2NewAepsClient(merchantRec?.merchant_id || undefined);
    const result = await client.transactionOtp({
      product_code: productCode,
      amount: String(amount),
      bankiin,
      customer_mobile: customerMobile,
      latitude: latitude || defaultLat,
      longitude: longitude || defaultLng,
      ip: clientIp,
      biometricData: {
        aadhaar_number: customerAadhaar,
        dc: dc ?? '', ci: ci ?? '', hmac: hmac ?? '',
        dpId: dpId ?? '', mc: mc ?? '', pidDataType: pidDataType ?? 'X',
        sessionKey: sessionKey ?? '', mi: mi ?? '', rdsId: rdsId ?? '',
        errCode: errCode ?? '0', fCount: fCount ?? '1', fType: fType ?? '2',
        iCount: iCount ?? '0', pCount: pCount ?? '0', pType: pType ?? '',
        srno: srno ?? '', pidData: pidData ?? '', qScore: qScore ?? '',
        nmPoints: nmPoints ?? '', rdsVer: rdsVer ?? '',
      },
    });

    const success = result.status === 1;
    return NextResponse.json({
      success,
      message: result.message || (success ? 'OTP sent to customer' : 'OTP request failed'),
      data: {
        referenceKey: result.data?.referenceKey || null,
        validity: result.data?.validity || null,
      },
      isMockMode: false,
    }, { status: success ? 200 : 400 });
  } catch (error: any) {
    console.error('[AEPS TxnOTP] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Transaction OTP failed' },
      { status: 500 },
    );
  }
}
