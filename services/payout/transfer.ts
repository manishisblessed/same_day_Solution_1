/**
 * Initiate Bank Transfer
 * SparkUpTech Express Pay Payout API: POST /expressPay2
 * 
 * Initiates IMPS/NEFT transfer to bank account
 */

import { payoutClient } from './payoutClient'
import { TransferRequest, TransferResponse } from './types'
import { isPayoutMockMode, getPayoutCharges, getTransferLimits } from './config'

/**
 * Generate unique client reference ID
 */
export function generateClientRefId(retailerId: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `PAY-${retailerId}-${timestamp}-${random}`
}

/**
 * Initiate bank transfer
 * 
 * @param request - Transfer details
 * @returns Transfer result
 */
export async function initiateTransfer(request: TransferRequest): Promise<{
  success: boolean
  transaction_id?: string
  client_ref_id?: string
  rrn?: string
  status?: 'PENDING' | 'SUCCESS' | 'FAILED' | 'PROCESSING'
  amount?: number
  charges?: number
  error?: string
}> {
  const { 
    accountNumber, 
    ifscCode, 
    accountHolderName, 
    amount, 
    transferMode, 
    remarks,
    clientRefId 
  } = request

  // Validate inputs
  if (!accountNumber || !ifscCode || !accountHolderName || !amount || !transferMode) {
    return {
      success: false,
      error: 'Account number, IFSC, account holder name, amount, and transfer mode are required',
    }
  }

  // Validate amount limits
  const limits = getTransferLimits()
  if (amount < limits.min) {
    return {
      success: false,
      error: `Minimum transfer amount is ₹${limits.min}`,
    }
  }
  if (amount > limits.max) {
    return {
      success: false,
      error: `Maximum transfer amount is ₹${limits.max}`,
    }
  }

  // Validate transfer mode
  if (!['IMPS', 'NEFT'].includes(transferMode)) {
    return {
      success: false,
      error: 'Transfer mode must be IMPS or NEFT',
    }
  }

  // Get charges
  const chargesConfig = getPayoutCharges()
  const charges = transferMode === 'IMPS' ? chargesConfig.imps : chargesConfig.neft

  // Generate client reference ID if not provided
  const refId = clientRefId || generateClientRefId('SYSTEM')

  // Mock mode
  if (isPayoutMockMode()) {
    // Simulate some failures for testing
    if (accountNumber.startsWith('999')) {
      return {
        success: false,
        error: 'Bank server temporarily unavailable',
      }
    }
    
    return {
      success: true,
      transaction_id: 'MOCK_TXN_' + Date.now(),
      client_ref_id: refId,
      rrn: 'MOCK_RRN_' + Math.random().toString(36).substring(2, 14).toUpperCase(),
      status: 'PENDING',
      amount,
      charges,
    }
  }

  try {
    const response = await payoutClient.request<TransferResponse>({
      method: 'POST',
      endpoint: '/expressPay2',
      body: {
        accountNumber,
        ifsc: ifscCode,
        name: accountHolderName,
        amount: amount.toString(),
        mode: transferMode,
        remarks: remarks || `Payout - ${refId}`,
        clientRefId: refId,
      },
    })

    if (!response.success || !response.data) {
      return {
        success: false,
        error: response.error || 'Failed to initiate transfer',
      }
    }

    const apiResponse = response.data

    if (!apiResponse.success) {
      return {
        success: false,
        error: apiResponse.message || apiResponse.error || 'Transfer initiation failed',
      }
    }

    const transferData = apiResponse.data

    return {
      success: true,
      transaction_id: transferData?.transactionId,
      client_ref_id: transferData?.clientRefId || refId,
      rrn: transferData?.rrn,
      status: transferData?.status || 'PENDING',
      amount: transferData?.amount || amount,
      charges: transferData?.charges || charges,
    }
  } catch (error: any) {
    console.error('Error initiating transfer:', error)
    return {
      success: false,
      error: error.message || 'Failed to initiate transfer',
    }
  }
}

