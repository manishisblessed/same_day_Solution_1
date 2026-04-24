import { NextRequest, NextResponse } from 'next/server';
import { mockAepsPayment } from '@/lib/aeps-mock';

/**
 * Mock AEPS Payment endpoint
 * POST /api/aeps/mock-payment
 * 
 * Simulates AEPS transactions (balance, withdraw, deposit, miniStatement)
 * without real device/Chagans biometrics
 * Use in Postman collection "5. AEPS Mock" for dev/test
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = mockAepsPayment(body);
    
    return NextResponse.json(result, {
      status: result.code,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[Mock AEPS Payment] Error:', error);
    return NextResponse.json(
      {
        success: false,
        code: 500,
        message: 'Mock payment failed',
        data: {
          status: 'failed',
          orderId: '',
          bankName: '',
          accountNumber: '',
          amount: 0,
          utr: '',
          bankAccountBalance: '0.00',
          miniStatement: [],
        },
        type: 'unknown',
      },
      { status: 500 }
    );
  }
}
