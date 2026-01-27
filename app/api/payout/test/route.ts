import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getPayoutBalance, getBankList, verifyBankAccount } from '@/services/payout'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * GET /api/payout/test
 * 
 * Tests all Express Pay Payout API endpoints.
 * Admin only - useful for verifying API connectivity.
 */
export async function GET(request: NextRequest) {
  try {
    // Get current user (only admin should be able to run tests)
    const user = await getCurrentUserFromRequest(request)
    const userRole = user?.role as string | undefined
    const isAdmin = userRole === 'admin' || userRole === 'super_admin'

    // Restrict to admin users only
    if (!isAdmin) {
      const response = NextResponse.json(
        { success: false, error: 'Access denied. Admin only.' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const results: {
      getBalance: { tested: boolean; success: boolean; balance?: number; available_balance?: number; error?: string }
      bankList: { tested: boolean; success: boolean; total_banks?: number; imps_enabled?: number; neft_enabled?: number; error?: string }
      timestamp: string
    } = {
      getBalance: { tested: false, success: false },
      bankList: { tested: false, success: false },
      timestamp: new Date().toISOString(),
    }

    // Test 1: getBalance API
    console.log('[Payout Test] Testing getBalance API...')
    results.getBalance.tested = true
    
    const balanceResult = await getPayoutBalance()
    if (balanceResult.success) {
      results.getBalance.success = true
      results.getBalance.balance = balanceResult.balance
      results.getBalance.available_balance = balanceResult.available_balance
    } else {
      results.getBalance.success = false
      results.getBalance.error = balanceResult.error
    }

    // Test 2: bankList API
    console.log('[Payout Test] Testing bankList API...')
    results.bankList.tested = true
    
    const bankResult = await getBankList({ useCache: false })
    if (bankResult.success) {
      results.bankList.success = true
      results.bankList.total_banks = bankResult.total
      results.bankList.imps_enabled = bankResult.imps_enabled
      results.bankList.neft_enabled = bankResult.neft_enabled
    } else {
      results.bankList.success = false
      results.bankList.error = bankResult.error
    }

    // Summary
    const allTestsPassed = results.getBalance.success && results.bankList.success
    
    const response = NextResponse.json({
      success: allTestsPassed,
      message: allTestsPassed 
        ? 'All Express Pay Payout API tests passed!' 
        : 'Some tests failed. Check results for details.',
      api: 'Express Pay Payout',
      results,
    })
    
    return addCorsHeaders(request, response)

  } catch (error: any) {
    console.error('[Payout Test] Error:', error)
    const response = NextResponse.json(
      { success: false, error: error.message || 'Test failed' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

