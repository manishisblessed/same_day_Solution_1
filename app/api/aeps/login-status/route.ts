import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUserWithFallback } from '@/lib/auth-server';
import { getMockLoginStatusResponse } from '@/lib/aeps-mock';
import { getAEPSConfig } from '@/services/aeps/config';
import { getAEPSService } from '@/services/aeps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AEPS_SESSION_HOURS = 24;

function isSessionValid(lastLoginAt: string | null, sessionHours: number): boolean {
  if (!lastLoginAt) return false;
  const loginTime = new Date(lastLoginAt).getTime();
  const now = Date.now();
  return (now - loginTime) < sessionHours * 60 * 60 * 1000;
}

/**
 * Check AEPS login status for merchant
 * POST /api/aeps/login-status
 * 
 * Returns whether 2FA session is valid (within 24 hours, same device).
 * If device changed or session expired, loginStatus = false to force re-auth.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, method } = await getCurrentUserWithFallback(request);
    console.log('[AEPS Login Status] Auth:', method, '|', user?.email || 'none');

    if (!user || !user.partner_id) {
      return NextResponse.json(
        { error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { merchantId: inputMerchantId, type = 'withdraw', deviceFingerprint } = body;

    if (!inputMerchantId) {
      return NextResponse.json(
        { error: 'merchantId is required' },
        { status: 400 }
      );
    }

    if (!['deposit', 'withdraw'].includes(type)) {
      return NextResponse.json(
        { error: 'type must be deposit or withdraw' },
        { status: 400 }
      );
    }

    const aepsService = getAEPSService();
    const config = getAEPSConfig();

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Query merchant record (needed for both mock and production)
    const { data: merchantRecord, error: dbError } = await supabase
      .from('aeps_merchants')
      .select('merchant_id, kyc_status, name, mobile, last_login_at, login_wadh, device_fingerprint')
      .eq('user_id', user.partner_id)
      .maybeSingle();

    // Check 24-hour session validity and device match
    const sessionActive = isSessionValid(merchantRecord?.last_login_at, AEPS_SESSION_HOURS);
    const deviceMatch = !deviceFingerprint || !merchantRecord?.device_fingerprint ||
      deviceFingerprint === merchantRecord.device_fingerprint;
    const twoFAValid = sessionActive && deviceMatch;

    // wadh goes into <Opts wadh="..."> for biometric capture — must be short or empty.
    // Chagans doesn't provide wadh; if a stale long value was stored (e.g. xId), discard it.
    const storedWadh = merchantRecord?.login_wadh || '';
    const safeWadh = storedWadh.length > 100 ? '' : storedWadh;

    // In mock mode, return mock data but respect 2FA session
    if (config.useMock) {
      const result = getMockLoginStatusResponse(inputMerchantId, type);

      if (merchantRecord?.kyc_status === 'validated' && twoFAValid) {
        return NextResponse.json({
          success: true,
          data: {
            loginStatus: true,
            bankList: result.data?.bankList || [],
            wadh: safeWadh || result.data?.wadh || null,
            route: result.data?.route || null,
            kycStatus: 'validated',
          },
          isMockMode: true,
        });
      }

      return NextResponse.json({
        success: result.success,
        data: {
          loginStatus: false,
          bankList: result.data?.bankList || [],
          wadh: result.data?.wadh || null,
          route: result.data?.route || null,
          kycStatus: merchantRecord?.kyc_status || result.data?.kycStatus || null,
          sessionExpired: sessionActive ? undefined : true,
          deviceChanged: deviceMatch ? undefined : true,
        },
        isMockMode: true,
      });
    }

    // --- PRODUCTION MODE ---

    if (dbError) {
      console.error('[AEPS Login Status] DB Error:', dbError);
    }

    // If no merchant record found, they need to complete KYC first
    if (!merchantRecord || !merchantRecord.merchant_id) {
      return NextResponse.json({
        success: false,
        data: {
          loginStatus: false,
          bankList: [],
          wadh: null,
          route: null,
          kycStatus: 'not_registered',
        },
        message: 'Merchant not registered. Please complete KYC first.',
        isMockMode: false,
      });
    }

    // Check if merchant has a pending/mock/temp ID
    const chagansMerchantId = merchantRecord.merchant_id;
    if (chagansMerchantId.startsWith('MOCK_') || chagansMerchantId.startsWith('TEMP_') || chagansMerchantId.startsWith('PENDING_') || chagansMerchantId.startsWith('CHAGANS_')) {
      if (merchantRecord.kyc_status === 'validated' && twoFAValid) {
        return NextResponse.json({
          success: true,
          data: {
            loginStatus: true,
            bankList: [
              { iin: '607094', bankName: 'HDFC Bank' },
              { iin: '607152', bankName: 'State Bank of India' },
              { iin: '505290', bankName: 'Axis Bank' },
              { iin: '607095', bankName: 'ICICI Bank' },
              { iin: '607161', bankName: 'Punjab National Bank' },
              { iin: '607389', bankName: 'Bank of Baroda' },
              { iin: '607027', bankName: 'Canara Bank' },
              { iin: '607105', bankName: 'Union Bank of India' },
            ],
            wadh: safeWadh || '',
            route: 'AIRTEL',
            kycStatus: merchantRecord.kyc_status,
            merchantName: merchantRecord.name,
          },
          message: 'Mock mode - merchant validated',
          isMockMode: true,
        });
      }
      
      return NextResponse.json({
        success: false,
        data: {
          loginStatus: false,
          bankList: [],
          wadh: null,
          route: null,
          kycStatus: merchantRecord.kyc_status || 'pending',
          sessionExpired: merchantRecord.kyc_status === 'validated' && !sessionActive ? true : undefined,
          deviceChanged: merchantRecord.kyc_status === 'validated' && !deviceMatch ? true : undefined,
        },
        message: merchantRecord.kyc_status === 'pending' 
          ? 'KYC verification in progress. Please wait.'
          : !sessionActive ? '2FA session expired. Please re-authenticate.'
          : !deviceMatch ? 'Device changed. Please re-authenticate.'
          : 'Please complete KYC registration for AEPS.',
        isMockMode: false,
      });
    }
    console.log('[AEPS Login Status] Using Chagans merchantId:', chagansMerchantId, 'for user:', user.partner_id);

    let result: any;
    try {
      result = await aepsService.checkLoginStatus(chagansMerchantId, type);
      console.log('[AEPS Login Status] Chagans result:', JSON.stringify(result).substring(0, 1000));
    } catch (apiError: any) {
      console.error('[AEPS Login Status] Chagans API error:', apiError.statusCode, apiError.message);
      if (apiError.statusCode === 429) {
        const retryAfter = apiError.data?.retryAfter || 10;
        return NextResponse.json({
          success: false,
          data: {
            loginStatus: false,
            bankList: [],
            wadh: null,
            route: null,
            kycStatus: merchantRecord.kyc_status,
          },
          message: `Too many requests. Please wait ${retryAfter} seconds and try again.`,
          retryAfter,
          isMockMode: false,
        }, { status: 429 });
      }
      // For 2FA valid sessions, return cached status on transient API errors
      if (twoFAValid) {
        return NextResponse.json({
          success: true,
          data: {
            loginStatus: true,
            bankList: [],
            wadh: safeWadh || null,
            route: null,
            kycStatus: merchantRecord.kyc_status,
          },
          message: 'Using cached session (Chagans temporarily unavailable)',
          isMockMode: false,
        });
      }
      throw apiError;
    }

    const bankList = (result.data?.bankList || []).map((b: any) => ({
      iin: b.iin,
      bankName: b.bankName || b.name || 'Unknown Bank',
    }));

    // Even if Chagans says logged in, our 24hr session / device check overrides
    const effectiveLoginStatus = twoFAValid && (result.data?.loginStatus || false);

    return NextResponse.json({
      success: result.success,
      data: {
        loginStatus: effectiveLoginStatus,
        bankList,
        wadh: effectiveLoginStatus ? (result.data?.wadh || safeWadh || null) : (result.data?.wadh || null),
        route: result.data?.route || null,
        kycStatus: merchantRecord.kyc_status || result.data?.kycStatus || null,
        sessionExpired: !sessionActive ? true : undefined,
        deviceChanged: !deviceMatch ? true : undefined,
      },
      isMockMode: false,
    });
  } catch (error: any) {
    console.error('[AEPS Login Status] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to check login status' },
      { status: 500 }
    );
  }
}
