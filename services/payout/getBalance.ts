/**
 * Get Payout Wallet Balance
 * SparkUpTech Express Pay Payout API: GET /getBalance
 */

import { payoutClient } from './payoutClient'
import { PayoutBalanceResponse } from './types'
import { isPayoutMockMode } from './config'

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
  error?: string
}> {
  // Mock mode
  if (isPayoutMockMode()) {
    return {
      success: true,
      balance: 10000,
      lien: 0,
      available_balance: 10000,
    }
  }

  try {
    const response = await payoutClient.request<PayoutBalanceResponse>({
      method: 'GET',
      endpoint: '/getBalance',
    })

    if (!response.success || !response.data) {
      return {
        success: false,
        error: response.error || 'Failed to fetch payout balance',
      }
    }

    const apiResponse = response.data

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
    }
  } catch (error: any) {
    console.error('Error fetching payout balance:', error)
    return {
      success: false,
      error: error.message || 'Failed to fetch payout balance',
    }
  }
}

