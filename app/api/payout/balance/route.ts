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
 * Express Pay Payout API - Get Balance
 * Endpoint: https://api.sparkuptech.in/api/fzep/payout/getBalance
 * 
 * Returns the SparkUpTech Express Pay Payout wallet balance.
 * This is used for bank payouts (IMPS/NEFT transfers).
 * 
 * Required Headers:
 * - partnerid: Partner/Merchant identifier
 * - consumerkey: API consumer key
 * - consumersecret: API consumer secret
 */
export async function GET(request: NextRequest) {
  try {
    // Get current user (only admin should be able to check payout balance)
    const user = await getCurrentUserFromRequest(request)
    const userRole = user?.role as string | undefined
    const isAdmin = userRole === 'admin' || userRole === 'super_admin'

    // Restrict to admin users only
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
    
    console.log('[Express Pay Payout] Fetching balance...')
    console.log('[Express Pay Payout] Partner ID:', partnerId)

    // Make API request to getBalance
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    const response = await fetch(`${PAYOUT_API_BASE_URL}/getBalance`, {
      method: 'GET',
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

    console.log('[Express Pay Payout] Response status:', response.status)
    console.log('[Express Pay Payout] Response:', JSON.stringify(data))

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
    const successResponse = NextResponse.json({
      success: true,
      api: 'Express Pay Payout - getBalance',
      endpoint: `${PAYOUT_API_BASE_URL}/getBalance`,
      balance: data?.data?.balance || data?.balance,
      lien: data?.data?.lien || data?.lien,
      available_balance: (data?.data?.balance || data?.balance || 0) - (data?.data?.lien || data?.lien || 0),
      raw_response: data,
      last_checked: new Date().toISOString(),
    })
    
    return addCorsHeaders(request, successResponse)

  } catch (error: any) {
    console.error('[Express Pay Payout] Error fetching balance:', error)
    
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
        error: error.message || 'Failed to fetch Express Pay Payout balance',
      },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

