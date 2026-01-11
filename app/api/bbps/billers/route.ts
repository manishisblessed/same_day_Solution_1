import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getCurrentUserServer } from '@/lib/auth-server'
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
    // Get cookies from request
    const cookieStore = await cookies()
    const cookieHeader = request.headers.get('cookie')
    
    // Get current user (server-side)
    const user = await getCurrentUserServer(cookieStore)
    if (!user) {
      console.error('BBPS Billers API: User not authenticated', {
        cookiesPresent: !!cookieHeader,
        cookieCount: cookieHeader ? cookieHeader.split(';').length : 0,
      })
      const response = NextResponse.json(
        { 
          error: 'Unauthorized',
          message: 'Please log in to access this feature. If you are logged in, try refreshing the page or logging in again.',
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

