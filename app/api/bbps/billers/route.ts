import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getCurrentUserServer } from '@/lib/auth-server'
import { getBillersByCategory } from '@/services/bbps'

// Mark this route as dynamic
export const dynamic = 'force-dynamic'

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
      return NextResponse.json(
        { 
          error: 'Unauthorized',
          message: 'Please log in to access this feature. If you are logged in, try refreshing the page or logging in again.',
        },
        { status: 401 }
      )
    }

    // Only retailers can fetch billers
    if (user.role !== 'retailer') {
      return NextResponse.json(
        { error: 'Forbidden: Only retailers can access this endpoint' },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category') || searchParams.get('blr_category_name') || undefined

    if (!category) {
      return NextResponse.json(
        { error: 'Category parameter is required' },
        { status: 400 }
      )
    }

    console.log(`Fetching billers for category: ${category}, user: ${user.email}`)
    const billers = await getBillersByCategory({ category })

    return NextResponse.json({
      success: true,
      billers,
      count: billers.length,
    })
  } catch (error: any) {
    console.error('Error fetching BBPS billers:', error)
    return NextResponse.json(
      { 
        error: error.message || 'Failed to fetch billers',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    )
  }
}

