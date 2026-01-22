import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
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
    // Try to get user but don't block if not authenticated
    // Billers list is semi-public - we log who accesses it but don't block
    let user = null
    try {
      user = await getCurrentUserFromRequest(request)
    } catch (e) {
      // Ignore auth errors for biller listing
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

    console.log(`Fetching billers for category: ${fieldValue}, payment channels: ${paymentChannelName1}, ${paymentChannelName2}, ${paymentChannelName3}, user: ${user?.email || 'anonymous'}`)
    
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

