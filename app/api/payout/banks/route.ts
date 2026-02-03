import { NextRequest, NextResponse } from 'next/server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getBankList } from '@/services/payout'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * GET /api/payout/banks
 * 
 * Returns the list of banks available for payout transfers.
 * This is public data - no authentication required.
 * 
 * Query Parameters:
 * - imps: Filter for IMPS-enabled banks only
 * - neft: Filter for NEFT-enabled banks only
 * - popular: Filter for popular banks only
 * - search: Search by bank name or IFSC
 */
export async function GET(request: NextRequest) {
  try {
    // Bank list is public reference data - no auth needed
    // Parse query parameters
    const { searchParams } = new URL(request.url)
    const impsOnly = searchParams.get('imps') === 'true'
    const neftOnly = searchParams.get('neft') === 'true'
    const popularOnly = searchParams.get('popular') === 'true'
    const searchQuery = searchParams.get('search') || undefined

    // Fetch bank list with error handling
    // If external API fails, return cached data or mock data
    const result = await getBankList({
      impsOnly,
      neftOnly,
      popularOnly,
      searchQuery,
      useCache: true, // Use cache if available
    })

    // If fetch failed but we have cached data, return that
    if (!result.success) {
      console.warn('[Payout Banks] External API failed, trying cache:', result.error)
      
      // Try again with cache only
      const cachedResult = await getBankList({
        impsOnly,
        neftOnly,
        popularOnly,
        searchQuery,
        useCache: true,
      })
      
      if (cachedResult.success && cachedResult.banks && cachedResult.banks.length > 0) {
        console.log('[Payout Banks] Returning cached bank list')
        const response = NextResponse.json({
          success: true,
          banks: cachedResult.banks,
          total: cachedResult.total,
          imps_enabled: cachedResult.imps_enabled,
          neft_enabled: cachedResult.neft_enabled,
          cached: true, // Indicate this is cached data
        })
        return addCorsHeaders(request, response)
      }
      
      // If no cache, return error
      const response = NextResponse.json(
        { 
          success: false, 
          error: result.error || 'Failed to fetch bank list. Please try again later.',
        },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    const response = NextResponse.json({
      success: true,
      banks: result.banks || [],
      total: result.total || 0,
      imps_enabled: result.imps_enabled || 0,
      neft_enabled: result.neft_enabled || 0,
    })
    
    return addCorsHeaders(request, response)

  } catch (error: any) {
    console.error('[Payout Banks] Unexpected error:', error)
    const response = NextResponse.json(
      { 
        success: false, 
        error: error.message || 'Failed to fetch bank list',
      },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

