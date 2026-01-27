/**
 * Get Transfer Status
 * SparkUpTech Express Pay Payout API: POST /transactionStatus
 * 
 * Checks the status of a payout transfer
 */

import { payoutClient } from './payoutClient'
import { TransferStatusRequest, TransferStatusResponse } from './types'
import { isPayoutMockMode } from './config'

/**
 * Get transfer status
 * 
 * @param request - Transaction ID or client reference ID
 * @returns Transfer status
 */
export async function getTransferStatus(request: TransferStatusRequest): Promise<{
  success: boolean
  transaction_id?: string
  client_ref_id?: string
  rrn?: string
  status?: 'PENDING' | 'SUCCESS' | 'FAILED' | 'PROCESSING'
  amount?: number
  charges?: number
  account_number?: string
  account_holder_name?: string
  bank_name?: string
  transfer_mode?: string
  failure_reason?: string
  completed_at?: string
  error?: string
}> {
  const { transactionId, clientRefId } = request

  // Validate inputs
  if (!transactionId && !clientRefId) {
    return {
      success: false,
      error: 'Either transaction ID or client reference ID is required',
    }
  }

  // Mock mode
  if (isPayoutMockMode()) {
    // Simulate different statuses based on ID
    const mockId = transactionId || clientRefId || ''
    
    if (mockId.includes('FAIL')) {
      return {
        success: true,
        transaction_id: mockId,
        status: 'FAILED',
        failure_reason: 'Bank account does not exist',
      }
    }
    
    if (mockId.includes('PROC')) {
      return {
        success: true,
        transaction_id: mockId,
        status: 'PROCESSING',
      }
    }
    
    return {
      success: true,
      transaction_id: mockId,
      client_ref_id: clientRefId,
      rrn: 'MOCK_RRN_' + Date.now(),
      status: 'SUCCESS',
      amount: 1000,
      charges: 5,
      account_number: '****1234',
      account_holder_name: 'TEST USER',
      bank_name: 'Test Bank',
      transfer_mode: 'IMPS',
      completed_at: new Date().toISOString(),
    }
  }

  try {
    const response = await payoutClient.request<TransferStatusResponse>({
      method: 'POST',
      endpoint: '/transactionStatus',
      body: {
        transactionId: transactionId || '',
        clientRefId: clientRefId || '',
      },
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
        error: apiResponse.message || apiResponse.error || 'Failed to fetch transfer status',
      }
    }

    const statusData = apiResponse.data

    return {
      success: true,
      transaction_id: statusData?.transactionId,
      client_ref_id: statusData?.clientRefId,
      rrn: statusData?.rrn,
      status: statusData?.status,
      amount: statusData?.amount,
      charges: statusData?.charges,
      account_number: statusData?.accountNumber,
      account_holder_name: statusData?.accountHolderName,
      bank_name: statusData?.bankName,
      transfer_mode: statusData?.transferMode,
      failure_reason: statusData?.failureReason,
      completed_at: statusData?.completedAt,
    }
  } catch (error: any) {
    console.error('Error fetching transfer status:', error)
    return {
      success: false,
      error: error.message || 'Failed to fetch transfer status',
    }
  }
}

