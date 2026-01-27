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
 * Express Pay Payout API - Test Connectivity
 * Tests all Express Pay Payout API endpoints
 * 
 * Returns:
 * - API connectivity status
 * - Wallet balance
 * - Bank list availability
 * 
 * This is useful for verifying the SparkUp wallet is configured correctly.
 */
export async function GET(request: NextRequest) {
  try {
    // Get current user (only admin should be able to run tests)
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

    const results: {
      credentials_configured: boolean
      partner_id: string
      getBalance: {
        tested: boolean
        success: boolean
        balance?: number
        lien?: number
        available_balance?: number
        error?: string
        response_time_ms?: number
      }
      bankList: {
        tested: boolean
        success: boolean
        total_banks?: number
        imps_enabled?: number
        neft_enabled?: number
        error?: string
        response_time_ms?: number
      }
      timestamp: string
    } = {
      credentials_configured: !!(partnerId && consumerKey && consumerSecret),
      partner_id: partnerId ? `${partnerId.substring(0, 4)}****` : 'NOT SET',
      getBalance: { tested: false, success: false },
      bankList: { tested: false, success: false },
      timestamp: new Date().toISOString(),
    }

    if (!results.credentials_configured) {
      const response = NextResponse.json({
        success: false,
        error: 'Express Pay Payout API credentials not configured',
        details: 'Missing BBPS_PARTNER_ID, BBPS_CONSUMER_KEY, or BBPS_CONSUMER_SECRET',
        results,
      }, { status: 500 })
      return addCorsHeaders(request, response)
    }

    const PAYOUT_API_BASE_URL = 'https://api.sparkuptech.in/api/fzep/payout'
    const headers = {
      'Content-Type': 'application/json',
      'partnerid': partnerId,
      'consumerkey': consumerKey,
      'consumersecret': consumerSecret,
    }

    // Test 1: getBalance API
    console.log('[Express Pay Payout Test] Testing getBalance API...')
    results.getBalance.tested = true
    
    try {
      const startTime = Date.now()
      const controller1 = new AbortController()
      const timeout1 = setTimeout(() => controller1.abort(), 30000)

      const balanceResponse = await fetch(`${PAYOUT_API_BASE_URL}/getBalance`, {
        method: 'GET',
        headers,
        signal: controller1.signal,
      })

      clearTimeout(timeout1)
      results.getBalance.response_time_ms = Date.now() - startTime

      const balanceText = await balanceResponse.text()
      let balanceData: any
      try {
        balanceData = JSON.parse(balanceText)
      } catch {
        balanceData = { raw_response: balanceText }
      }

      console.log('[Express Pay Payout Test] getBalance response:', JSON.stringify(balanceData))

      if (balanceResponse.ok && balanceData.success) {
        results.getBalance.success = true
        results.getBalance.balance = balanceData.data?.balance || balanceData.balance || 0
        results.getBalance.lien = balanceData.data?.lien || balanceData.lien || 0
        results.getBalance.available_balance = (results.getBalance.balance || 0) - (results.getBalance.lien || 0)
      } else {
        results.getBalance.success = false
        results.getBalance.error = balanceData.message || balanceData.error || `HTTP ${balanceResponse.status}`
      }
    } catch (error: any) {
      results.getBalance.success = false
      results.getBalance.error = error.name === 'AbortError' ? 'Request timeout' : error.message
    }

    // Test 2: bankList API
    console.log('[Express Pay Payout Test] Testing bankList API...')
    results.bankList.tested = true
    
    try {
      const startTime = Date.now()
      const controller2 = new AbortController()
      const timeout2 = setTimeout(() => controller2.abort(), 30000)

      const bankListResponse = await fetch(`${PAYOUT_API_BASE_URL}/bankList`, {
        method: 'POST',
        headers,
        signal: controller2.signal,
      })

      clearTimeout(timeout2)
      results.bankList.response_time_ms = Date.now() - startTime

      const bankListText = await bankListResponse.text()
      let bankListData: any
      try {
        bankListData = JSON.parse(bankListText)
      } catch {
        bankListData = { raw_response: bankListText }
      }

      console.log('[Express Pay Payout Test] bankList response status:', bankListResponse.status)

      if (bankListResponse.ok && bankListData.success) {
        const banks = bankListData.data || []
        results.bankList.success = true
        results.bankList.total_banks = banks.length
        results.bankList.imps_enabled = banks.filter((b: any) => b.isIMPS).length
        results.bankList.neft_enabled = banks.filter((b: any) => b.isNEFT).length
      } else {
        results.bankList.success = false
        results.bankList.error = bankListData.message || bankListData.error || `HTTP ${bankListResponse.status}`
      }
    } catch (error: any) {
      results.bankList.success = false
      results.bankList.error = error.name === 'AbortError' ? 'Request timeout' : error.message
    }

    // Summary
    const allTestsPassed = results.getBalance.success && results.bankList.success
    
    const response = NextResponse.json({
      success: allTestsPassed,
      message: allTestsPassed 
        ? 'All Express Pay Payout API tests passed!' 
        : 'Some tests failed. Check results for details.',
      api: 'Express Pay Payout',
      base_url: PAYOUT_API_BASE_URL,
      results,
    })
    
    return addCorsHeaders(request, response)

  } catch (error: any) {
    console.error('[Express Pay Payout Test] Error:', error)
    const response = NextResponse.json(
      { 
        success: false, 
        error: error.message || 'Test failed',
      },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

