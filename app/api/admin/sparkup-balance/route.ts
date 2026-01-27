import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getBBPSWalletBalance } from '@/services/bbps'
import { getPayoutBalance } from '@/services/payout'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * GET /api/admin/sparkup-balance
 * 
 * Returns all Sparkup provider balances for admin dashboard.
 * This includes:
 * - BBPS Wallet Balance (for bill payments)
 * - Payout Balance (for DMT/IMPS/NEFT transfers)
 * 
 * Admin only endpoint.
 */
export async function GET(request: NextRequest) {
  try {
    // Get current admin user with fallback
    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Sparkup Balance] Auth method:', method, '| User:', admin?.email || 'none')
    
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

    // Fetch both balances in parallel for better performance
    const [bbpsResult, payoutResult] = await Promise.all([
      getBBPSWalletBalance(),
      getPayoutBalance()
    ])

    // Calculate totals
    const bbpsAvailable = bbpsResult.success 
      ? (bbpsResult.balance || 0) - (bbpsResult.lien || 0) 
      : 0
    
    const payoutAvailable = payoutResult.success 
      ? payoutResult.available_balance || 0 
      : 0

    const totalAvailable = bbpsAvailable + payoutAvailable

    const response = NextResponse.json({
      success: true,
      provider: 'SparkUpTech',
      last_checked: new Date().toISOString(),
      
      // BBPS Wallet (for bill payments)
      bbps: {
        success: bbpsResult.success,
        balance: bbpsResult.balance || 0,
        lien: bbpsResult.lien || 0,
        available_balance: bbpsAvailable,
        error: bbpsResult.error || null,
        service_name: 'BBPS (Bill Payments)'
      },
      
      // Payout Wallet (for DMT/transfers)
      payout: {
        success: payoutResult.success,
        balance: payoutResult.balance || 0,
        lien: payoutResult.lien || 0,
        available_balance: payoutAvailable,
        error: payoutResult.error || null,
        service_name: 'Payout (DMT/IMPS/NEFT)'
      },
      
      // Summary
      summary: {
        total_balance: (bbpsResult.balance || 0) + (payoutResult.balance || 0),
        total_lien: (bbpsResult.lien || 0) + (payoutResult.lien || 0),
        total_available: totalAvailable,
        all_services_healthy: bbpsResult.success && payoutResult.success
      }
    })
    
    return addCorsHeaders(request, response)

  } catch (error: any) {
    console.error('[Sparkup Balance] Error:', error)
    const response = NextResponse.json(
      { 
        success: false, 
        error: error.message || 'Failed to fetch Sparkup balance',
        provider: 'SparkUpTech'
      },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

