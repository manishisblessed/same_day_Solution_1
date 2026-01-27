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

    // Fetch bank list
    const result = await getBankList({
      impsOnly,
      neftOnly,
      popularOnly,
      searchQuery,
    })

    if (!result.success) {
      const response = NextResponse.json(
        { 
          success: false, 
          error: result.error || 'Failed to fetch bank list',
        },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    const response = NextResponse.json({
      success: true,
      banks: result.banks,
      total: result.total,
      imps_enabled: result.imps_enabled,
      neft_enabled: result.neft_enabled,
    })
    
    return addCorsHeaders(request, response)

  } catch (error: any) {
    console.error('[Payout Banks] Error:', error)
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

