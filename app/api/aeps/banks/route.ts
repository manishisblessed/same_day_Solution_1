import { NextRequest, NextResponse } from 'next/server';
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

    const merchantId = request.nextUrl.searchParams.get('merchantId');

    if (!merchantId) {
      return NextResponse.json(
        { error: 'merchantId query param is required' },
        { status: 400 }
      );
    }

    const aepsService = getAEPSService();
    const banks = await aepsService.getBanks(merchantId);

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
