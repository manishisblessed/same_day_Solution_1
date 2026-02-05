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
  // New fields from updated API response
  deducted_amount?: number
  service_charge?: number
  remark?: string
  req_id?: string
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
    // API uses query parameters: transaction_id and sub_service_name
    const endpoint = `/statusCheck?transaction_id=${encodeURIComponent(transactionId)}&sub_service_name=ExpressPay`
    const response = await payoutClient.request<TransferStatusResponse>({
      method: 'POST',
      endpoint,
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

    // Handle new API response format
    // New format uses responseCode (number) and status (string)
    // Legacy format uses status (number) and msg (string)
    
    let statusCode: number
    let statusString: string
    let mappedStatus: 'pending' | 'success' | 'failed' | 'processing'

    // Check for new format first
    if (statusData.responseCode !== undefined) {
      statusCode = statusData.responseCode
      statusString = statusData.status || 'pending'
    } else if (typeof statusData.status === 'number') {
      // Legacy format
      statusCode = statusData.status
      statusString = statusData.msg || 'PENDING'
    } else if (typeof statusData.status === 'string') {
      // New format with string status
      statusString = statusData.status.toLowerCase()
      // Map string status to code
      if (statusString === 'success') {
        statusCode = 2
      } else if (statusString === 'pending') {
        statusCode = 1
      } else {
        statusCode = 0
      }
    } else {
      // Default to pending
      statusCode = 1
      statusString = 'pending'
    }

    // Map status code to our format
    mappedStatus = mapStatusCode(statusCode)

    // Use new format fields if available, fallback to legacy
    const amount = statusData.transactionAmount ?? statusData.amount
    const deductedAmount = statusData.deductedAmount
    const serviceCharge = statusData.serviceCharge
    const referenceId = statusData.rpid ?? statusData.referenceNo
    const accountNumber = statusData.account
    const balance = statusData.bal
    const remark = statusData.remark
    const operatorId = statusData.opid
    const errorCode = statusData.errorcode
    const reqId = statusData.reqId

    console.log('[Payout Status] Status check result:', {
      transaction_id: transactionId,
      status: mappedStatus,
      status_code: statusCode,
      amount,
      deductedAmount,
      serviceCharge,
      referenceId,
    })

    return {
      success: true,
      transaction_id: statusData.transaction_id || transactionId,
      status: mappedStatus,
      status_code: statusCode,
      status_message: statusString.toUpperCase(),
      amount,
      account_number: accountNumber,
      balance,
      reference_id: referenceId,
      operator_id: operatorId,
      error_code: errorCode,
      // Additional fields from new format
      deducted_amount: deductedAmount,
      service_charge: serviceCharge,
      remark,
      req_id: reqId,
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
