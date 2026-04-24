import { NextRequest, NextResponse } from 'next/server';
import { mockAepsLogin } from '@/lib/aeps-mock';

/**
 * Mock AEPS Login endpoint
 * POST /api/aeps/mock-login
 * 
 * Simulates successful AEPS biometric login without real device/Chagans
 * Use in Postman collection "5. AEPS Mock" for dev/test
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = mockAepsLogin(body);
    
    return NextResponse.json(result, {
      status: result.code,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[Mock AEPS Login] Error:', error);
    return NextResponse.json(
      {
        success: false,
        code: 500,
        message: 'Mock login failed',
        data: {
          loginStatus: false,
          bankList: [],
          wadh: '',
          route: '',
          kycStatus: '',
        },
      },
      { status: 500 }
    );
  }
}
