import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUserWithFallback } from '@/lib/auth-server';
import { authorizeSubPartner, normalizeMasterPartner } from '@/lib/partner-access';
import { getAEPSClient, getAEPSConfig } from '@/services/aeps';
import { isAEPSProviderPay2New } from '@/services/aeps/config';
import { getPay2NewAepsService } from '@/services/pay2new-aeps';
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * AEPS Biometric Login (Daily Authentication)
 * POST /api/aeps/login
 * 
 * This endpoint handles biometric authentication for AEPS daily login.
 * Required before performing any AEPS transactions.
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
    console.log('[AEPS Login] Auth:', method, '|', user?.email || 'none');
    normalizeMasterPartner(user);

    const access = authorizeSubPartner(user, 'aeps');
    if (!access.ok) return access.response;

    if (!user || !user.partner_id) {
      return NextResponse.json(
        { error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      merchantId,
      transType = 'withdraw',
      wadh,
      deviceFingerprint,
      // Pay2New-specific: merchant's own Aadhaar for daily login
      merchantAadhaar,
      latitude,
      longitude,
      // Biometric data from RD service
      bioType,
      dc, ci, hmac, dpId, mc, pidDataType, mi,
      rdsId, sessionKey, fCount, errCode, pCount,
      fType, iCount, pType, srno, pidData, qScore,
      nmPoints, rdsVer, errInfo, iType, sysid, ts,
    } = body;

    if (!merchantId) {
      return NextResponse.json(
        { error: 'merchantId is required' },
        { status: 400 }
      );
    }

    // ── Pay2New provider path ─────────────────────────────────────────────────
    if (isAEPSProviderPay2New()) {
      if (!merchantAadhaar || !/^\d{12}$/.test(merchantAadhaar)) {
        return NextResponse.json(
          { error: 'merchantAadhaar (12 digits) is required for Pay2New daily login' },
          { status: 400 }
        );
      }
      if (!pidData || !sessionKey) {
        return NextResponse.json({ error: 'Biometric capture data is required' }, { status: 400 });
      }

      try {
        // Look up stored merchant_id (per-merchant outletId from PAN onboarding)
        const { data: merchantRec } = await supabase
          .from('aeps_merchants')
          .select('merchant_id')
          .eq('user_id', user.partner_id)
          .maybeSingle();
        console.log('[AEPS Login] Pay2New: outletId=', merchantRec?.merchant_id, 'user=', user.partner_id);
        const p2nService = getPay2NewAepsService(merchantRec?.merchant_id || undefined);

        // Quick pre-check: what does Pay2New say about biometric KYC?
        try {
          const kycCheck = await p2nService.checkBioKycStatus();
          console.log('[AEPS Login] Pay2New bioKycStatus:', JSON.stringify(kycCheck));
        } catch (kErr: any) {
          console.warn('[AEPS Login] Pay2New bioKycStatus check failed:', kErr.message);
        }

        const loginResult = await p2nService.merchantLogin({
          merchantAadhaar,
          latitude,
          longitude,
          captureType: bioType === 'FACE' ? 'FACE' : 'FINGER',
          type: 'DAILY_LOGIN',
          rdFields: { dc, ci, hmac, dpId, mc, pidDataType, mi, rdsId, sessionKey, fCount, errCode, pCount, fType, iCount, pType, srno, pidData, qScore, nmPoints, rdsVer, errInfo, iType, sysid, ts, bioType },
        });

        console.log('[AEPS Login] Pay2New loginResult:', JSON.stringify(loginResult));
        const success = loginResult.status === 1;

        if (success) {
          await supabase
            .from('aeps_merchants')
            .update({
              last_login_at: new Date().toISOString(),
              login_wadh: null,
              device_fingerprint: deviceFingerprint || null,
              login_ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown',
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', user.partner_id);

          const ctx = getRequestContext(request);
          logActivityFromContext(ctx, user, {
            activity_type: 'aeps_login',
            activity_category: 'aeps',
            activity_description: 'Pay2New AePS merchant login successful',
            reference_id: merchantId,
          }).catch(() => {});

          return NextResponse.json({
            success: true,
            message: loginResult.message || 'Login successful',
            isMockMode: false,
            data: { wadh: null, loginStatus: true, route: 'INSTANTPAY' },
          });
        }

        // Pay2New says KYC required — re-check and tell frontend to redo KYC
        const msg = (loginResult.message || '').toLowerCase();
        if (msg.includes('kyc is required') || msg.includes('update your kyc') || msg.includes('kyc not')) {
          console.log('[AEPS Login] Pay2New KYC not done — syncing local status to pending');
          await supabase
            .from('aeps_merchants')
            .update({ kyc_status: 'pending', updated_at: new Date().toISOString() })
            .eq('user_id', user.partner_id);

          // Fetch the actual biometric KYC status so frontend knows what to do
          let needsBiometric = false;
          let referenceKey: string | null = null;
          let pidOptionWadh: string | null = null;
          try {
            const kycCheck = await p2nService.checkBioKycStatus();
            const kd = kycCheck.data;
            needsBiometric = kd?.action === 'ACTION-REQUIRED';
            referenceKey = kd?.referenceKey || null;
            pidOptionWadh = kd?.pidOptionWadh || null;
          } catch (_) {}

          return NextResponse.json({
            success: false,
            error: loginResult.message,
            kycRequired: true,
            needsBiometric,
            referenceKey,
            pidOptionWadh,
            data: { loginStatus: false },
          }, { status: 400 });
        }

        return NextResponse.json({
          success: false,
          message: loginResult.message || 'Login failed',
          isMockMode: false,
          data: { wadh: null, loginStatus: false, route: 'INSTANTPAY' },
        }, { status: 400 });
      } catch (err: any) {
        console.error('[AEPS Login] Pay2New error:', err);
        return NextResponse.json(
          { success: false, error: err.message || 'Login failed', data: { loginStatus: false } },
          { status: 500 }
        );
      }
    }
    // ── End Pay2New path ──────────────────────────────────────────────────────

    const config = getAEPSConfig();

    // In mock mode, return mock login success
    if (config.useMock) {
      const mockWadh = `MOCK_WADH_${Date.now()}`;
      
      await supabase
        .from('aeps_merchants')
        .update({
          last_login_at: new Date().toISOString(),
          login_wadh: mockWadh,
          device_fingerprint: deviceFingerprint || null,
          login_ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown',
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.partner_id);

      return NextResponse.json({
        success: true,
        message: 'Login successful (mock mode)',
        isMockMode: true,
        data: {
          wadh: mockWadh,
          loginStatus: true,
          route: 'AIRTEL',
        }
      });
    }

    // Production mode - validate biometric data
    console.log('[AEPS Login] Fields received:', {
      merchantId, transType, wadh: wadh ? `${wadh.substring(0, 20)}...` : 'MISSING',
      bioType, dc: dc ? 'present' : 'MISSING', ci: ci || 'MISSING',
      hmac: hmac ? 'present' : 'MISSING', dpId, mc: mc ? 'present' : 'MISSING',
      pidDataType, mi, rdsId, rdsVer, sessionKey: sessionKey ? 'present' : 'MISSING',
      fCount, errCode, pCount, fType, iCount, pType,
      srno: srno || 'MISSING', pidData: pidData ? 'present' : 'MISSING',
      qScore, nmPoints
    });

    if (!pidData || !sessionKey) {
      return NextResponse.json(
        { error: 'Biometric data is required for authentication' },
        { status: 400 }
      );
    }

    // Get merchant from database
    const { data: merchantRecord, error: dbError } = await supabase
      .from('aeps_merchants')
      .select('merchant_id, kyc_status, name')
      .eq('user_id', user.partner_id)
      .maybeSingle();

    if (dbError || !merchantRecord) {
      return NextResponse.json(
        { error: 'Merchant not found. Please complete KYC registration.' },
        { status: 404 }
      );
    }

    // Call Chagans AEPS login API
    const aepsClient = getAEPSClient();

    // Local kyc_status is a cache that can lag behind Chagans (the source of truth).
    // login-status falls back to Chagans' kycStatus and may route the merchant here
    // even when our local column isn't yet 'validated'. Re-check with Chagans and
    // sync the cache before rejecting, so the two endpoints can't disagree.
    let effectiveKycStatus = merchantRecord.kyc_status;
    if (effectiveKycStatus !== 'validated') {
      try {
        const statusCheck = await aepsClient.checkLoginStatus({
          merchantId: merchantRecord.merchant_id,
          type: transType === 'deposit' ? 'deposit' : 'withdraw',
        });
        if (statusCheck.data?.kycStatus === 'validated') {
          effectiveKycStatus = 'validated';
          await supabase
            .from('aeps_merchants')
            .update({ kyc_status: 'validated', updated_at: new Date().toISOString() })
            .eq('user_id', user.partner_id);
          console.log('[AEPS Login] Synced local kyc_status -> validated from Chagans');
        }
      } catch (e) {
        console.error('[AEPS Login] KYC re-check failed:', e);
      }
    }

    if (effectiveKycStatus !== 'validated') {
      return NextResponse.json(
        { error: 'KYC not validated. Please complete KYC first.' },
        { status: 400 }
      );
    }
    
    try {
      const loginResponse = await aepsClient.aepsLogin({
        merchantId: merchantRecord.merchant_id,
        transType,
        wadh: wadh || '',
        bioType: bioType || 'FINGER',
        dc, ci, hmac, dpId, mc, pidDataType, mi,
        rdsId, sessionKey, fCount, errCode, pCount,
        fType, iCount, pType, srno, pidData, qScore,
        nmPoints, rdsVer
      });

      console.log('[AEPS Login] Chagans response:', JSON.stringify(loginResponse).substring(0, 500));

      if (loginResponse.success) {
        // wadh is a UIDAI biometric hash used in <Opts wadh="..."> XML.
        // Chagans does NOT return wadh — their xId is an internal reference, NOT a wadh.
        // wadh must be short/empty; passing a long string causes device error 850.
        const responseWadh = loginResponse.data?.wadh || '';

        console.log('[AEPS Login] Resolved wadh:', responseWadh || 'EMPTY (normal for Chagans)');

        await supabase
          .from('aeps_merchants')
          .update({
            last_login_at: new Date().toISOString(),
            login_wadh: responseWadh,
            device_fingerprint: deviceFingerprint || null,
            login_ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown',
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.partner_id);

        const ctx = getRequestContext(request);
        logActivityFromContext(ctx, user, {
          activity_type: 'aeps_login',
          activity_category: 'aeps',
          activity_description: 'AEPS biometric login successful',
          reference_id: merchantRecord.merchant_id,
          metadata: { transType, route: loginResponse.data?.route, xId: (loginResponse as any).xId },
        }).catch(() => {});

        return NextResponse.json({
          success: true,
          message: loginResponse.message || 'Login successful',
          isMockMode: false,
          data: {
            wadh: responseWadh,
            loginStatus: true,
            route: loginResponse.data?.route || 'AIRTEL',
            bankList: (loginResponse.data as any)?.bankList || [],
          }
        });
      }

      const isRetryable = (loginResponse as any).retry === true ||
        (loginResponse.message || '').toLowerCase().includes('kyc update successful');

      if (isRetryable) {
        return NextResponse.json({
          success: false,
          retry: true,
          message: loginResponse.message || 'KYC updated. Please retry login.',
          data: { loginStatus: false }
        });
      }

      return NextResponse.json({
        success: false,
        error: loginResponse.message || 'Authentication failed',
        data: {
          loginStatus: false,
        }
      }, { status: 400 });
    } catch (apiError: any) {
      console.error('[AEPS Login] API Error:', apiError);
      return NextResponse.json({
        success: false,
        error: apiError.message || 'Authentication failed',
        data: {
          loginStatus: false,
        }
      }, { status: 500 });
    }
  } catch (error: any) {
    console.error('[AEPS Login] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Login failed' },
      { status: 500 }
    );
  }
}
