import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getBillersByCategory } from '@/services/bbps'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'

// Mark this route as dynamic
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function GET(request: NextRequest) {
  try {
    // Get current user with fallback
    const { user, method } = await getCurrentUserWithFallback(request)
    console.log('[BBPS Billers] Auth:', method, '|', user?.email || 'none')
    
    if (!user) {
      const response = NextResponse.json(
        { 
          error: 'Unauthorized',
          message: 'Session expired. Please log in again.',
          code: 'SESSION_EXPIRED'
        },
        { status: 401 }
      )
      return addCorsHeaders(request, response)
    }

    // Only retailers can fetch billers
    if (user.role !== 'retailer') {
      const response = NextResponse.json(
        { error: 'Forbidden: Only retailers can access this endpoint' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category') || searchParams.get('blr_category_name') || undefined

    if (!category) {
      const response = NextResponse.json(
        { error: 'Category parameter is required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    console.log(`Fetching billers for category: ${category}, user: ${user.email}`)
    const billers = await getBillersByCategory({ category })

    const response = NextResponse.json({
      success: true,
      billers,
      count: billers.length,
    })
    
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('Error fetching BBPS billers:', error)
    const response = NextResponse.json(
      { 
        error: 'Failed to fetch billers',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

