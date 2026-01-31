/**
 * Get Payout Wallet Balance
 * SparkUpTech API: GET /api/wallet/getBalance
 * 
 * Note: This endpoint uses a different base URL than other payout APIs
 */

import { PayoutBalanceResponse } from './types'
import { isPayoutMockMode, getPartnerId, getConsumerKey, getConsumerSecret, getPayoutTimeout } from './config'

// Wallet API base URL (different from payout API)
const WALLET_API_URL = 'https://api.sparkuptech.in/api/wallet'

/**
 * Get payout wallet balance
 * 
 * @returns Wallet balance information
 */
export async function getPayoutBalance(): Promise<{
  success: boolean
  balance?: number
  lien?: number
  available_balance?: number
  is_active?: boolean
  client_id?: string
  error?: string
}> {
  // Mock mode
  if (isPayoutMockMode()) {
    return {
      success: true,
      balance: 10000,
      lien: 0,
      available_balance: 10000,
      is_active: true,
    }
  }

  try {
    // Validate credentials
    const partnerId = getPartnerId()
    const consumerKey = getConsumerKey()
    const consumerSecret = getConsumerSecret()

    if (!partnerId || !consumerKey || !consumerSecret) {
      return {
        success: false,
        error: 'Payout API credentials not configured',
      }
    }

    // Create abort controller for timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), getPayoutTimeout())

    // Make GET request to wallet API
    // UPDATED Jan 31, 2026: Per Sparkup support - headers must use camelCase for consumerKey/consumerSecret
    const response = await fetch(`${WALLET_API_URL}/getBalance`, {
      method: 'GET',
      headers: {
        'partnerid': partnerId,
        'consumerKey': consumerKey, // FIXED: camelCase per Sparkup Jan 2026
        'consumerSecret': consumerSecret, // FIXED: camelCase per Sparkup Jan 2026
      },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    // Parse response
    const responseText = await response.text()
    let apiResponse: PayoutBalanceResponse

    try {
      apiResponse = JSON.parse(responseText)
    } catch {
      console.error('[Payout Balance] Invalid JSON response:', responseText.substring(0, 200))
      return {
        success: false,
        error: 'Invalid response from wallet API',
      }
    }

    // Log response
    console.log('[Payout Balance] Response:', {
      success: apiResponse.success,
      status: apiResponse.status,
      balance: apiResponse.data?.balance,
    })

    // Handle error responses
    if (!response.ok) {
      return {
        success: false,
        error: apiResponse.message || `HTTP ${response.status}`,
      }
    }

    if (!apiResponse.success || !apiResponse.data) {
      return {
        success: false,
        error: apiResponse.message || 'Failed to fetch payout balance',
      }
    }

    const balanceData = apiResponse.data
    const balance = balanceData.balance || 0
    const lien = balanceData.lien || 0

    return {
      success: true,
      balance,
      lien,
      available_balance: balance - lien,
      is_active: balanceData.is_active,
      client_id: balanceData.client_id,
    }
  } catch (error: any) {
    // Handle timeout
    if (error.name === 'AbortError') {
      console.error('[Payout Balance] Request timeout')
      return {
        success: false,
        error: 'Request timeout',
      }
    }

    console.error('[Payout Balance] Error:', error)
    return {
      success: false,
      error: error.message || 'Failed to fetch payout balance',
    }
  }
}
