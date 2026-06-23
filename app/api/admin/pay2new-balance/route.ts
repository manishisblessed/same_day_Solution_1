import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getPay2NewBalance } from '@/services/pay2new'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function GET(request: NextRequest) {
  try {
    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Pay2New Balance] Auth method:', method, '| User:', admin?.email || 'none')

    if (!admin) {
      const response = NextResponse.json(
        { error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      )
      return addCorsHeaders(request, response)
    }

    if (admin.role !== 'admin') {
      const response = NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const result = await getPay2NewBalance()

    const response = NextResponse.json({
      success: result.success,
      provider: 'Pay2New',
      last_checked: new Date().toISOString(),
      balance: result.balance ?? null,
      error: result.error || null,
      service_name: 'Pay2New (Credit Card Bill Payment)',
    })

    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[Pay2New Balance] Error:', error)
    const response = NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch Pay2New balance' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
