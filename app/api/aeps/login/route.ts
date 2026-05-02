import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUserWithFallback } from '@/lib/auth-server';
import { getAEPSClient, getAEPSConfig } from '@/services/aeps';
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
      // Biometric data from RD service
      bioType,
      dc, ci, hmac, dpId, mc, pidDataType, mi,
      rdsId, sessionKey, fCount, errCode, pCount,
      fType, iCount, pType, srno, pidData, qScore,
      nmPoints, rdsVer
    } = body;

    if (!merchantId) {
      return NextResponse.json(
        { error: 'merchantId is required' },
        { status: 400 }
      );
    }

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

    if (merchantRecord.kyc_status !== 'validated') {
      return NextResponse.json(
        { error: 'KYC not validated. Please complete KYC first.' },
        { status: 400 }
      );
    }

    // Call Chagans AEPS login API
    const aepsClient = getAEPSClient();
    
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
