import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { getBBPSWalletBalance } from '@/services/bbps'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * GET /api/bbps/wallet-balance
 * 
 * Returns the SparkUpTech BBPS provider wallet balance.
 * This is the company's master BBPS account balance with the provider.
 * 
 * - Admin: Full details (balance, lien, available)
 * - Retailers: Limited info (just availability status)
 */
export async function GET(request: NextRequest) {
  try {
    // Get current user
    const user = await getCurrentUserFromRequest(request)
    
    // Allow all authenticated users to check (useful for retailers to see if BBPS is available)
    // But sensitive details only for admins
    const userRole = user?.role as string | undefined
    const isAdmin = userRole === 'admin' || userRole === 'super_admin'
    
    // Fetch SparkUpTech BBPS wallet balance
    const balanceResult = await getBBPSWalletBalance()
    
    if (!balanceResult.success) {
      const response = NextResponse.json(
        { 
          success: false, 
          error: balanceResult.error || 'Failed to fetch BBPS provider balance',
          bbps_available: false,
        },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }
    
    // Calculate available balance (balance - lien)
    const availableBalance = (balanceResult.balance || 0) - (balanceResult.lien || 0)
    
    // For non-admin users, just return availability status
    if (!isAdmin && !user) {
      const response = NextResponse.json({
        success: true,
        bbps_available: availableBalance > 0,
      })
      return addCorsHeaders(request, response)
    }
    
    // For authenticated users (retailers, distributors, etc.)
    // Show limited info
    if (!isAdmin) {
      const response = NextResponse.json({
        success: true,
        bbps_available: availableBalance > 1000, // Consider available if > ₹1000
        min_transaction: 1,
        max_transaction: Math.min(availableBalance, 49999), // BBPS limit or available balance
      })
      return addCorsHeaders(request, response)
    }
    
    // For admins, return full details
    const response = NextResponse.json({
      success: true,
      balance: balanceResult.balance,
      lien: balanceResult.lien,
      available_balance: availableBalance,
      bbps_available: availableBalance > 1000,
      provider: 'SparkUpTech',
      last_checked: new Date().toISOString(),
    })
    return addCorsHeaders(request, response)
    
  } catch (error: any) {
    console.error('Error fetching BBPS wallet balance:', error)
    const response = NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch BBPS balance',
        bbps_available: false,
      },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

