import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { fetchBillerInfo } from '@/lib/bbps/service'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function POST(request: NextRequest) {
  try {
    // Get current user with fallback
    const { user, method } = await getCurrentUserWithFallback(request)
    console.log('[BBPS Biller Info] Auth:', method, '|', user?.email || 'none')
    
    if (!user) {
      const response = NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
      return addCorsHeaders(request, response)
    }

    // Only retailers can fetch biller info
    if (user.role !== 'retailer') {
      const response = NextResponse.json(
        { error: 'Forbidden: Only retailers can access this endpoint' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const body = await request.json()
    const { biller_id } = body

    if (!biller_id) {
      const response = NextResponse.json(
        { error: 'biller_id is required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const billerInfo = await fetchBillerInfo(biller_id)

    const response = NextResponse.json({
      success: true,
      biller_info: billerInfo,
    })
    
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('Error fetching biller info:', error)
    const response = NextResponse.json(
      { error: 'Failed to fetch biller info' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}






