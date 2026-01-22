/**
 * Get Wallet Balance Service
 * SparkUpTech BBPS API: GET /wallet/getBalance
 * 
 * Fetches wallet balance from BBPS service
 */

import { bbpsClient } from './bbpsClient'
import { generateReqId, logBBPSApiCall, logBBPSApiError } from './helpers'
import { isMockMode } from './config'

/**
 * Response from BBPS Wallet Balance API
 */
interface BBPSWalletBalanceResponse {
  success: boolean
  status?: number
  message?: string
  data?: {
    _id?: string
    balance?: number
    lien?: number
    is_active?: boolean
    created_at?: string
    updated_at?: string
    first_name?: string
    middle_name?: string
    last_name?: string
    email?: string
    mobile?: string
    client_id?: string
  }
}

/**
 * Get wallet balance from BBPS service
 * 
 * @returns Wallet balance information
 * 
 * @example
 * ```typescript
 * const balance = await getBBPSWalletBalance()
 * ```
 */
export async function getBBPSWalletBalance(): Promise<{
  success: boolean
  balance?: number
  lien?: number
  error?: string
}> {
  const reqId = generateReqId()

  // Use mock data if enabled
  if (isMockMode()) {
    logBBPSApiCall('getBBPSWalletBalance', reqId, undefined, 'MOCK')
    return {
      success: true,
      balance: 10000,
      lien: 0,
    }
  }

  try {
    // Wallet balance endpoint uses different base URL: /api/wallet (not /api/ba)
    // Extract base URL and adjust for wallet endpoint
    const baseUrl = process.env.BBPS_API_BASE_URL || 'https://api.sparkuptech.in/api/ba'
    const walletBaseUrl = baseUrl.replace('/ba', '') || 'https://api.sparkuptech.in/api'

    // Make API request
    const response = await bbpsClient.request<BBPSWalletBalanceResponse>({
      method: 'GET',
      endpoint: '/wallet/getBalance',
      body: undefined,
      reqId,
      baseUrl: walletBaseUrl,
      includeAuthToken: false,
    })

    if (!response.success || !response.data) {
      logBBPSApiError('getBBPSWalletBalance', reqId, response.error || 'Unknown error')
      return {
        success: false,
        error: response.error || 'Failed to fetch wallet balance',
      }
    }

    const apiResponse = response.data

    // Check if request was successful
    if (!apiResponse.success || !apiResponse.data) {
      return {
        success: false,
        error: apiResponse.message || 'Failed to fetch wallet balance',
      }
    }

    const balanceData = apiResponse.data

    logBBPSApiCall(
      'getBBPSWalletBalance',
      reqId,
      undefined,
      response.status,
      apiResponse.success ? 'SUCCESS' : 'FAILED'
    )

    return {
      success: true,
      balance: balanceData.balance || 0,
      lien: balanceData.lien || 0,
    }
  } catch (error: any) {
    logBBPSApiError('getBBPSWalletBalance', reqId, error)
    return {
      success: false,
      error: error.message || 'Failed to fetch wallet balance',
    }
  }
}

