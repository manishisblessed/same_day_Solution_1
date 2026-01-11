import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { getBillersByCategoryAndChannel } from '@/services/bbps'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'

// Mark this route as dynamic
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function POST(request: NextRequest) {
  try {
    // Get current user (server-side)
    const user = await getCurrentUserServer()
    if (!user) {
      console.error('BBPS Billers by Category API: User not authenticated')
      console.error('Request headers:', {
        cookie: request.headers.get('cookie') ? 'Present' : 'Missing',
        authorization: request.headers.get('authorization') ? 'Present' : 'Missing',
      })
      const response = NextResponse.json(
        { 
          error: 'Unauthorized',
          message: 'Please log in to access this feature. If you are logged in, try refreshing the page.',
          debug: process.env.NODE_ENV === 'development' ? 'Session cookie may not be passed correctly' : undefined
        },
        { status: 401 }
      )
      return addCorsHeaders(request, response)
    }

    // Only RETAILER role can access BBPS APIs
    // Normalize role to uppercase for comparison
    const userRole = user.role?.toUpperCase()
    if (userRole !== 'RETAILER') {
      const response = NextResponse.json(
        { error: 'Forbidden: Only retailers can access this endpoint' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    // Parse request body
    const body = await request.json()
    const { fieldValue, paymentChannelName1, paymentChannelName2, paymentChannelName3 } = body

    if (!fieldValue) {
      const response = NextResponse.json(
        { error: 'fieldValue (category) parameter is required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    console.log(`Fetching billers for category: ${fieldValue}, payment channels: ${paymentChannelName1}, ${paymentChannelName2}, ${paymentChannelName3}, user: ${user.email}`)
    
    const billers = await getBillersByCategoryAndChannel({
      fieldValue,
      paymentChannelName1,
      paymentChannelName2,
      paymentChannelName3,
    })

    const response = NextResponse.json({
      success: true,
      msg: 'Detail Fetched',
      data: billers,
      count: billers.length,
    })
    
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('Error fetching BBPS billers by category:', error)
    const response = NextResponse.json(
      { 
        success: false,
        error: 'Failed to fetch billers',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

