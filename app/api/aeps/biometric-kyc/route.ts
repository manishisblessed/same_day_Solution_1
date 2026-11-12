import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUserWithFallback } from '@/lib/auth-server';
import { authorizeSubPartner, normalizeMasterPartner } from '@/lib/partner-access';
import { getPay2NewAepsService } from '@/services/pay2new-aeps';
import { isAEPSProviderPay2New } from '@/services/aeps/config';
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Pay2New AePS Biometric KYC submission
 * POST /api/aeps/biometric-kyc
 *
 * Step 2 of Pay2New merchant onboarding:
 *   1. GET /api/aeps/biometric-kyc-status  → get referenceKey + action
 *   2. POST /api/aeps/biometric-kyc        → submit biometric KYC (this route)
 *   3. GET /api/aeps/biometric-kyc-status  → confirm APPROVED
 *
 * Only available when AEPS_PROVIDER=pay2new.
 */
export async function POST(request: NextRequest) {
  if (!isAEPSProviderPay2New()) {
    return NextResponse.json(
      { error: 'This endpoint is only available when AEPS_PROVIDER=pay2new' },
      { status: 404 },
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    const { user, method } = await getCurrentUserWithFallback(request);
    console.log('[AEPS BioKYC] Auth:', method, '|', user?.email || 'none');
    normalizeMasterPartner(user);

    const access = authorizeSubPartner(user, 'aeps');
    if (!access.ok) return access.response;

    if (!user?.partner_id) {
      return NextResponse.json(
        { error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' },
        { status: 401 },
      );
    }

    const body = await request.json();
    const {
      referenceKey,
      merchantAadhaar,
      latitude,
      longitude,
      // RD biometric fields
      dc, ci, hmac, dpId, mc, pidDataType, mi,
      rdsId, sessionKey, fCount, errCode, pCount,
      fType, iCount, pType, srno, pidData, qScore,
      nmPoints, rdsVer, errInfo, iType, sysid, ts,
    } = body;

    if (!referenceKey) {
      return NextResponse.json({ error: 'referenceKey is required (from biometricKycStatus)' }, { status: 400 });
    }
    if (!merchantAadhaar || !/^\d{12}$/.test(merchantAadhaar)) {
      return NextResponse.json({ error: 'merchantAadhaar (12 digits) is required' }, { status: 400 });
    }
    if (!pidData || !sessionKey) {
      return NextResponse.json({ error: 'Biometric capture data is required' }, { status: 400 });
    }

    const requestId = `BKYC_${user.partner_id}_${Date.now()}`;

    // Use per-merchant outletId from DB
    const { data: merchantRec } = await supabase
      .from('aeps_merchants')
      .select('merchant_id')
      .eq('user_id', user.partner_id)
      .maybeSingle();
    const service = getPay2NewAepsService(merchantRec?.merchant_id || undefined);
    const result = await service.submitBioKyc({
      referenceKey,
      merchantAadhaar,
      latitude,
      longitude,
      requestId,
      rdFields: { dc, ci, hmac, dpId, mc, pidDataType, mi, rdsId, sessionKey, fCount, errCode, pCount, fType, iCount, pType, srno, pidData, qScore, nmPoints, rdsVer, errInfo, iType, sysid, ts },
    });

    const success = result.status === 1;

    if (success) {
      // Update merchant KYC status — pending bank approval; re-check via biometricKycStatus
      await supabase
        .from('aeps_merchants')
        .update({ kyc_status: 'pending', updated_at: new Date().toISOString() })
        .eq('user_id', user.partner_id);

      const ctx = getRequestContext(request);
      logActivityFromContext(ctx, user, {
        activity_type: 'aeps_biometric_kyc',
        activity_category: 'aeps',
        activity_description: 'Pay2New AePS biometric KYC submitted',
        reference_id: result.order_id || undefined,
      }).catch(() => {});
    }

    return NextResponse.json({
      success,
      message: result.message || (success ? 'KYC submitted successfully' : 'KYC submission failed'),
      orderId: result.order_id,
      isMockMode: false,
    });
  } catch (error: any) {
    console.error('[AEPS BioKYC] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Biometric KYC submission failed' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/aeps/biometric-kyc — check KYC status
 * Returns current biometric KYC state and referenceKey if action needed.
 */
export async function GET(request: NextRequest) {
  if (!isAEPSProviderPay2New()) {
    return NextResponse.json(
      { error: 'This endpoint is only available when AEPS_PROVIDER=pay2new' },
      { status: 404 },
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    const { user, method } = await getCurrentUserWithFallback(request);
    normalizeMasterPartner(user);

    const access = authorizeSubPartner(user, 'aeps');
    if (!access.ok) return access.response;

    if (!user?.partner_id) {
      return NextResponse.json({ error: 'Session expired.', code: 'SESSION_EXPIRED' }, { status: 401 });
    }

    // Use per-merchant outletId from DB
    const { data: merchantRec } = await supabase
      .from('aeps_merchants')
      .select('merchant_id')
      .eq('user_id', user.partner_id)
      .maybeSingle();
    const service = getPay2NewAepsService(merchantRec?.merchant_id || undefined);
    const result = await service.checkBioKycStatus();

    const data = result.data;
    const isApproved = data?.status === 'APPROVED' && data?.action === 'NO-ACTION-REQUIRED';
    const needsBiometric = data?.action === 'ACTION-REQUIRED';

    // Sync local kyc_status when APPROVED
    if (isApproved) {
      await supabase
        .from('aeps_merchants')
        .update({ kyc_status: 'validated', updated_at: new Date().toISOString() })
        .eq('user_id', user.partner_id);
    }

    return NextResponse.json({
      success: result.status === 1,
      message: result.message,
      data: {
        kycStatus: data?.status || null,
        action: data?.action || null,
        referenceKey: data?.referenceKey || null,
        pidOptionWadh: data?.pidOptionWadh || null,
        customerAadhaarMasked: data?.customer_aadhaar_number || null,
        isApproved,
        needsBiometric,
      },
      isMockMode: false,
    });
  } catch (error: any) {
    console.error('[AEPS BioKYC Status] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to check KYC status' },
      { status: 500 },
    );
  }
}
