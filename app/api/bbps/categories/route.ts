import { NextRequest, NextResponse } from 'next/server'
import { getBBPSCategories } from '@/lib/bbps/categories'

// Mark this route as dynamic (though it could be static, keeping it dynamic for consistency)
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Categories are public - no authentication needed
    const categories = getBBPSCategories()

    return NextResponse.json({
      success: true,
      categories,
      count: categories.length,
    })
  } catch (error: any) {
    console.error('Error fetching BBPS categories:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch categories' },
      { status: 500 }
    )
  }
}

