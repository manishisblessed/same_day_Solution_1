import { NextRequest, NextResponse } from 'next/server'
import { getBBPSCategories } from '@/lib/bbps/categories'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'

// Mark this route as dynamic (though it could be static, keeping it dynamic for consistency)
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function GET(request: NextRequest) {
  try {
    // Categories are public - no authentication needed
    const categories = getBBPSCategories()

    const response = NextResponse.json({
      success: true,
      categories,
      count: categories.length,
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

