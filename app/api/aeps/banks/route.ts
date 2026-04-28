import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUserWithFallback } from '@/lib/auth-server';
import { getAEPSService } from '@/services/aeps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Get available banks for AEPS
 * GET /api/aeps/banks?merchantId=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const { user, method } = await getCurrentUserWithFallback(request);
    console.log('[AEPS Banks] Auth:', method, '|', user?.email || 'none');

    if (!user || !user.partner_id) {
      return NextResponse.json(
        { error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      );
    }

    const inputMerchantId = request.nextUrl.searchParams.get('merchantId');

    if (!inputMerchantId) {
      return NextResponse.json(
        { error: 'merchantId query param is required' },
        { status: 400 }
      );
    }

    const aepsService = getAEPSService();

    // In production mode, look up the real Chagans merchantId
    let chagansMerchantId = inputMerchantId;
    if (!aepsService.isMockMode()) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      const { data: merchantRecord } = await supabase
        .from('aeps_merchants')
        .select('merchant_id')
        .eq('user_id', user.partner_id)
        .maybeSingle();

      if (merchantRecord?.merchant_id) {
        chagansMerchantId = merchantRecord.merchant_id;
      }
    }

    const rawBanks = await aepsService.getBanks(chagansMerchantId);

    const banks = rawBanks.map((b: any) => ({
      iin: b.iin,
      bankName: b.bankName || b.name || 'Unknown Bank',
    }));

    return NextResponse.json({
      success: true,
      data: banks,
      count: banks.length,
    });
  } catch (error: any) {
    console.error('[AEPS Banks] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch banks' },
      { status: 500 }
    );
  }
}
