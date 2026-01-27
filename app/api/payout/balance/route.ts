import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getPayoutBalance } from '@/services/payout'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * GET /api/payout/balance
 * 
 * Returns the SparkUpTech Express Pay Payout wallet balance.
 * This is used for bank payouts (IMPS/NEFT transfers).
 * 
 * - Admin: Full balance details
 * - Retailers: Can check if payout service is available
 */
export async function GET(request: NextRequest) {
  try {
    // Get current user
    const user = await getCurrentUserFromRequest(request)
    const userRole = user?.role as string | undefined
    const isAdmin = userRole === 'admin' || userRole === 'super_admin'
    const isRetailer = userRole === 'retailer'

    // Restrict to admin and retailer users only
    if (!isAdmin && !isRetailer) {
      const response = NextResponse.json(
        { success: false, error: 'Access denied.' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    // Fetch payout balance using service
    const balanceResult = await getPayoutBalance()
    
    if (!balanceResult.success) {
      const response = NextResponse.json(
        { 
          success: false, 
          error: balanceResult.error || 'Failed to fetch payout balance',
          payout_available: false,
        },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    // For retailers, just return availability status
    if (!isAdmin) {
      const response = NextResponse.json({
        success: true,
        payout_available: (balanceResult.available_balance || 0) > 1000,
        min_transfer: 100,
        max_transfer: Math.min(balanceResult.available_balance || 0, 200000),
      })
      return addCorsHeaders(request, response)
    }

    // For admins, return full details
    const response = NextResponse.json({
      success: true,
      balance: balanceResult.balance,
      lien: balanceResult.lien,
      available_balance: balanceResult.available_balance,
      payout_available: (balanceResult.available_balance || 0) > 1000,
      provider: 'SparkUpTech Express Pay',
      last_checked: new Date().toISOString(),
    })
    
    return addCorsHeaders(request, response)

  } catch (error: any) {
    console.error('[Payout Balance] Error:', error)
    const response = NextResponse.json(
      { 
        success: false, 
        error: error.message || 'Failed to fetch payout balance',
        payout_available: false,
      },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

