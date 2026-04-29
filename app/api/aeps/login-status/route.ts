import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUserWithFallback } from '@/lib/auth-server';
import { getMockLoginStatusResponse } from '@/lib/aeps-mock';
import { getAEPSConfig } from '@/services/aeps/config';
import { getAEPSService } from '@/services/aeps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Check AEPS login status for merchant
 * POST /api/aeps/login-status
 * 
 * IMPORTANT: The merchantId sent from frontend can be either:
 * - Our internal partner_id (e.g., RET35258193)
 * - Or an already-resolved Chagans merchantId
 * 
 * We look up the real Chagans merchantId from aeps_merchants table.
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
    const { merchantId: inputMerchantId, type = 'withdraw' } = body;

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

    // In mock mode, return mock data directly
    if (config.useMock) {
      const result = getMockLoginStatusResponse(inputMerchantId, type);
      return NextResponse.json({
        success: result.success,
        data: {
          loginStatus: result.data?.loginStatus || false,
          bankList: result.data?.bankList || [],
          wadh: result.data?.wadh || null,
          route: result.data?.route || null,
          kycStatus: result.data?.kycStatus || null,
        },
        isMockMode: true,
      });
    }

    // --- PRODUCTION MODE ---
    // Look up the real Chagans merchantId from our database
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Query by user_id (partner_id) to find the Chagans merchant_id
    const { data: merchantRecord, error: dbError } = await supabase
      .from('aeps_merchants')
      .select('merchant_id, kyc_status, name, mobile')
      .eq('user_id', user.partner_id)
      .maybeSingle();

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

    // Check if merchant has a pending/mock/temp ID - they need to complete or retry KYC
    const chagansMerchantId = merchantRecord.merchant_id;
    if (chagansMerchantId.startsWith('MOCK_') || chagansMerchantId.startsWith('TEMP_') || chagansMerchantId.startsWith('PENDING_') || chagansMerchantId.startsWith('CHAGANS_')) {
      // Check KYC status - if validated, allow to proceed (mock mode for testing)
      if (merchantRecord.kyc_status === 'validated') {
        // Mock/test mode - allow transactions
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
            wadh: `WADH_${Date.now()}`,
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
        },
        message: merchantRecord.kyc_status === 'pending' 
          ? 'KYC verification in progress. Please wait.' 
          : 'Please complete KYC registration for AEPS.',
        isMockMode: false,
      });
    }
    console.log('[AEPS Login Status] Using Chagans merchantId:', chagansMerchantId, 'for user:', user.partner_id);

    const result = await aepsService.checkLoginStatus(chagansMerchantId, type);
    console.log('[AEPS Login Status] Chagans result:', JSON.stringify(result).substring(0, 1000));
    console.log('[AEPS Login Status] wadh from Chagans:', result.data?.wadh || 'NOT_PRESENT');

    const bankList = (result.data?.bankList || []).map((b: any) => ({
      iin: b.iin,
      bankName: b.bankName || b.name || 'Unknown Bank',
    }));

    return NextResponse.json({
      success: result.success,
      data: {
        loginStatus: result.data?.loginStatus || false,
        bankList,
        wadh: result.data?.wadh || null,
        route: result.data?.route || null,
        kycStatus: merchantRecord.kyc_status || result.data?.kycStatus || null,
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
