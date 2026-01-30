/**
 * Get Transfer Status
 * SparkUpTech Express Pay Payout API: POST /statusCheck?transaction_id=UTRxxxx
 * 
 * Checks the status of a payout transfer
 */

import { payoutClient } from './payoutClient'
import { TransferStatusRequest, TransferStatusResponse } from './types'
import { isPayoutMockMode } from './config'
import { mapStatusCode } from './transfer'

/**
 * Get transfer status by transaction ID
 * 
 * @param request - Transaction ID (UTR number)
 * @returns Transfer status
 */
export async function getTransferStatus(request: TransferStatusRequest): Promise<{
  success: boolean
  transaction_id?: string
  status?: 'pending' | 'success' | 'failed' | 'processing'
  status_code?: number
  status_message?: string
  amount?: number
  account_number?: string
  balance?: number
  reference_id?: string
  operator_id?: string
  error_code?: string
  error?: string
}> {
  const { transactionId } = request

  // Validate inputs
  if (!transactionId) {
    return {
      success: false,
      error: 'Transaction ID is required',
    }
  }

  // Mock mode
  if (isPayoutMockMode()) {
    // Simulate different statuses based on ID
    if (transactionId.includes('FAIL')) {
      return {
        success: true,
        transaction_id: transactionId,
        status: 'failed',
        status_code: 0,
        status_message: 'FAILED',
        error: 'Transaction failed',
      }
    }
    
    if (transactionId.includes('PEND')) {
      return {
        success: true,
        transaction_id: transactionId,
        status: 'pending',
        status_code: 1,
        status_message: 'PENDING',
      }
    }
    
    return {
      success: true,
      transaction_id: transactionId,
      status: 'success',
      status_code: 2,
      status_message: 'SUCCESS',
      amount: 1000,
      account_number: '****1234',
      balance: 5000,
      reference_id: 'S' + Date.now(),
      operator_id: 'OPR' + Date.now(),
    }
  }

  try {
    // API uses query parameter for transaction_id
    const response = await payoutClient.request<TransferStatusResponse>({
      method: 'POST',
      endpoint: `/statusCheck?transaction_id=${encodeURIComponent(transactionId)}`,
    })

    if (!response.success || !response.data) {
      return {
        success: false,
        error: response.error || 'Failed to fetch transfer status',
      }
    }

    const apiResponse = response.data

    if (!apiResponse.success) {
      return {
        success: false,
        error: apiResponse.error || 'Failed to fetch transfer status',
      }
    }

    const statusData = apiResponse.data

    if (!statusData) {
      return {
        success: false,
        error: 'No status data returned',
      }
    }

    // Map API response to our format
    // API returns: status 2 = SUCCESS, 1 = PENDING, 0 = FAILED
    const statusCode = statusData.status ?? 1
    const mappedStatus = mapStatusCode(statusCode)

    return {
      success: true,
      transaction_id: transactionId,
      status: mappedStatus,
      status_code: statusCode,
      status_message: statusData.msg,
      amount: statusData.amount,
      account_number: statusData.account,
      balance: statusData.bal,
      reference_id: statusData.rpid,
      operator_id: statusData.opid,  // This is the RRN/UTR from bank
      error_code: statusData.errorcode,
    }
  } catch (error: any) {
    console.error('Error fetching transfer status:', error)
    return {
      success: false,
      error: error.message || 'Failed to fetch transfer status',
    }
  }
}

/**
 * Poll transfer status until final state
 * 
 * @param transactionId - Transaction ID to check
 * @param maxAttempts - Maximum polling attempts (default 10)
 * @param intervalMs - Interval between polls in ms (default 5000)
 * @returns Final status
 */
export async function pollTransferStatus(
  transactionId: string,
  maxAttempts: number = 10,
  intervalMs: number = 5000
): Promise<{
  success: boolean
  status?: 'pending' | 'success' | 'failed'
  status_message?: string
  operator_id?: string
  error?: string
}> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await getTransferStatus({ transactionId })

    if (!result.success) {
      return {
        success: false,
        error: result.error,
      }
    }

    // If status is final (success or failed), return
    if (result.status === 'success' || result.status === 'failed') {
      return {
        success: true,
        status: result.status,
        status_message: result.status_message,
        operator_id: result.operator_id,
      }
    }

    // Wait before next poll
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, intervalMs))
    }
  }

  // Max attempts reached, return pending status
  return {
    success: true,
    status: 'pending',
    status_message: 'Transaction still pending after maximum polling attempts',
  }
}
