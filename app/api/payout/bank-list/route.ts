import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * Express Pay Payout API - Get Bank List
 * Endpoint: https://api.sparkuptech.in/api/fzep/payout/bankList
 * 
 * Returns the list of banks available for payout (IMPS/NEFT transfers).
 * 
 * Required Headers:
 * - partnerid: Partner/Merchant identifier
 * - consumerkey: API consumer key
 * - consumersecret: API consumer secret
 */
export async function POST(request: NextRequest) {
  try {
    // Get current user
    const user = await getCurrentUserFromRequest(request)
    const userRole = user?.role as string | undefined
    const isAdmin = userRole === 'admin' || userRole === 'super_admin'

    // Restrict to authenticated users only (admin for now)
    if (!isAdmin) {
      const response = NextResponse.json(
        { success: false, error: 'Access denied. Admin only.' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    // Get credentials from environment
    const partnerId = process.env.BBPS_PARTNER_ID || process.env.BBPS_CLIENT_ID || ''
    const consumerKey = process.env.BBPS_CONSUMER_KEY || ''
    const consumerSecret = process.env.BBPS_CONSUMER_SECRET || ''

    if (!partnerId || !consumerKey || !consumerSecret) {
      const response = NextResponse.json(
        { 
          success: false, 
          error: 'Express Pay Payout API credentials not configured',
          details: 'Missing BBPS_PARTNER_ID, BBPS_CONSUMER_KEY, or BBPS_CONSUMER_SECRET'
        },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    // Express Pay Payout API base URL
    const PAYOUT_API_BASE_URL = 'https://api.sparkuptech.in/api/fzep/payout'
    
    console.log('[Express Pay Payout] Fetching bank list...')

    // Make API request to bankList
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    const response = await fetch(`${PAYOUT_API_BASE_URL}/bankList`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'partnerid': partnerId,
        'consumerkey': consumerKey,
        'consumersecret': consumerSecret,
      },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    const responseText = await response.text()
    let data: any
    
    try {
      data = JSON.parse(responseText)
    } catch {
      data = { raw_response: responseText }
    }

    console.log('[Express Pay Payout] Bank list response status:', response.status)

    if (!response.ok) {
      const errorResponse = NextResponse.json(
        { 
          success: false, 
          error: data?.message || data?.error || `HTTP ${response.status}`,
          http_status: response.status,
          api_response: data
        },
        { status: response.status }
      )
      return addCorsHeaders(request, errorResponse)
    }

    // Success response
    const banks = data?.data || []
    const successResponse = NextResponse.json({
      success: true,
      api: 'Express Pay Payout - bankList',
      endpoint: `${PAYOUT_API_BASE_URL}/bankList`,
      message: data?.message || 'Bank list fetched successfully',
      total_banks: banks.length,
      banks: banks.slice(0, 20), // Return first 20 banks for testing
      imps_enabled_count: banks.filter((b: any) => b.isIMPS).length,
      neft_enabled_count: banks.filter((b: any) => b.isNEFT).length,
    })
    
    return addCorsHeaders(request, successResponse)

  } catch (error: any) {
    console.error('[Express Pay Payout] Error fetching bank list:', error)
    
    // Handle timeout
    if (error.name === 'AbortError') {
      const response = NextResponse.json(
        { success: false, error: 'Request timeout after 30 seconds' },
        { status: 504 }
      )
      return addCorsHeaders(request, response)
    }

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

