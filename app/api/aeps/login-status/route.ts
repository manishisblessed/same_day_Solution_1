import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserWithFallback } from '@/lib/auth-server';
import { getAEPSService } from '@/services/aeps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Check AEPS login status for merchant
 * POST /api/aeps/login-status
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
    const { merchantId, type = 'withdraw' } = body;

    if (!merchantId) {
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
    const result = await aepsService.checkLoginStatus(merchantId, type);

    return NextResponse.json({
      success: result.success,
      data: {
        loginStatus: result.data?.loginStatus || false,
        bankList: result.data?.bankList || [],
        wadh: result.data?.wadh || null,
        route: result.data?.route || null,
        kycStatus: result.data?.kycStatus || null,
      },
      isMockMode: aepsService.isMockMode(),
    });
  } catch (error: any) {
    console.error('[AEPS Login Status] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to check login status' },
      { status: 500 }
    );
  }
}
