import { NextRequest, NextResponse } from 'next/server'
import { getBBPSCategories } from '@/lib/bbps/categories'
import { getBBPSProvider } from '@/services/bbps/config'
import { getChagansCategoryDisplayNames } from '@/services/bbps/chagansCategories'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'

// Mark this route as dynamic (though it could be static, keeping it dynamic for consistency)
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function GET(request: NextRequest) {
  try {
    let categories: string[]
    let source: 'chagans' | 'chagans_fallback' | 'static' = 'static'

    if (getBBPSProvider() === 'chagans') {
      if (process.env.USE_BBPS_MOCK === 'true') {
        categories = getBBPSCategories()
        source = 'static'
      } else {
        try {
          categories = await getChagansCategoryDisplayNames()
          source = 'chagans'
        } catch (e) {
          console.error('[BBPS categories] Chagans getCategory failed, using static list:', e)
          categories = getBBPSCategories()
          source = 'chagans_fallback'
        }
      }
    } else {
      categories = getBBPSCategories()
    }

    const response = NextResponse.json({
      success: true,
      categories,
      count: categories.length,
      source,
    })
    
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('Error fetching BBPS categories:', error)
    const response = NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

