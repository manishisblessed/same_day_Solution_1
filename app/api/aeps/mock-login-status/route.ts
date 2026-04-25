import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserWithFallback } from '@/lib/auth-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Mock AEPS Login Status
 * POST /api/aeps/mock-login-status
 * Returns mock login status and bank list for testing
 */
export async function POST(request: NextRequest) {
  try {
    const { user, method } = await getCurrentUserWithFallback(request);
    console.log('[AEPS Mock Login Status] Auth:', method, '|', user?.email || 'none');

    if (!user || !user.partner_id) {
      return NextResponse.json(
        { error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { merchantId, type = 'withdraw' } = body;

    // Mock response with sample banks
    return NextResponse.json({
      success: true,
      code: 200,
      message: 'Mock login status retrieved',
      data: {
        loginStatus: false, // Not logged in initially
        bankList: [
          { iin: '607152', bankName: 'State Bank of India' },
          { iin: '607094', bankName: 'HDFC Bank' },
          { iin: '607095', bankName: 'ICICI Bank' },
          { iin: '607161', bankName: 'Punjab National Bank' },
          { iin: '505290', bankName: 'Axis Bank' },
          { iin: '607153', bankName: 'Bank of Baroda' },
          { iin: '607096', bankName: 'Kotak Mahindra Bank' },
          { iin: '607154', bankName: 'Canara Bank' },
        ],
        kycStatus: 'pending', // Will be 'validated' after KYC
        route: 'AIRTEL',
      },
    });
  } catch (error: any) {
    console.error('[AEPS Mock Login Status] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to check mock login status' },
      { status: 500 }
    );
  }
}
