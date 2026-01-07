/**
 * Transaction Status Service
 * SparkUpTech BBPS API: POST /bbps/transactionStatus
 * 
 * Fetches transaction status for a BBPS payment
 */

import { bbpsClient } from './bbpsClient'
import { generateReqId, logBBPSApiCall, logBBPSApiError } from './helpers'
import { isMockMode } from './config'
import { BBPSTransactionStatus } from './types'
import { getMockTransactionStatus } from './mocks/transactionStatus'

/**
 * Request parameters for transactionStatus
 */
export interface TransactionStatusParams {
  transactionId: string
  trackType?: 'TRANS_REF_ID' | 'AGENT_TXN_ID' | string
}

/**
 * Response from BBPS API
 */
interface BBPSTransactionStatusResponse {
  success: boolean
  status?: string
  message?: string
  data?: {
    responseCode?: string
    responseReason?: string
    txnList?: {
      txnReferenceId?: string
      txnStatus?: string
      amount?: string | number
      [key: string]: any
    }
    statusRequestId?: string
    [key: string]: any
  }
}

/**
 * Get transaction status
 * 
 * @param params - Transaction ID and track type
 * @returns Transaction status information
 * 
 * @example
 * ```typescript
 * const status = await transactionStatus({
 *   transactionId: 'CC015056BAAE00071350',
 *   trackType: 'TRANS_REF_ID'
 * })
 * ```
 */
export async function transactionStatus(
  params: TransactionStatusParams
): Promise<BBPSTransactionStatus> {
  const { transactionId, trackType = 'TRANS_REF_ID' } = params
  const reqId = generateReqId()

  // Validate input
  if (!transactionId || transactionId.trim() === '') {
    throw new Error('Transaction ID is required')
  }

  // Use mock data if enabled
  if (isMockMode()) {
    logBBPSApiCall('transactionStatus', reqId, undefined, 'MOCK')
    return getMockTransactionStatus(transactionId)
  }

  try {
    // Prepare request body
    const requestBody = {
      reqData: {
        transactionStatusReq: {
          trackValue: transactionId,
          trackType,
        },
      },
      reqId,
    }

    // Make API request
    const response = await bbpsClient.request<BBPSTransactionStatusResponse>({
      method: 'POST',
      endpoint: '/bbps/transactionStatus',
      body: requestBody,
      reqId,
    })

    if (!response.success || !response.data) {
      logBBPSApiError('transactionStatus', reqId, response.error || 'Unknown error')
      throw new Error(response.error || 'Failed to fetch transaction status')
    }

    const apiResponse = response.data

    // Validate response structure
    if (!apiResponse.success || !apiResponse.data) {
      throw new Error(apiResponse.message || 'Failed to fetch transaction status')
    }

    const txnList = apiResponse.data.txnList || {}
    const isSuccess =
      apiResponse.data.responseCode === '000' &&
      txnList.txnStatus === 'SUCCESS'

    // Parse amount safely
    const amountValue = txnList.amount
    const parsedAmount: number = amountValue 
      ? (typeof amountValue === 'number' ? amountValue : parseFloat(String(amountValue)))
      : 0

    // Extract additional fields from txnList, excluding amount
    const { amount: _, ...restTxnList } = txnList

    // Transform API response to BBPSTransactionStatus format
    const transactionStatus: BBPSTransactionStatus = {
      transaction_id: txnList.txnReferenceId || transactionId,
      status: txnList.txnStatus || apiResponse.data.responseReason || 'UNKNOWN',
      payment_status: txnList.txnStatus || apiResponse.data.responseReason || 'UNKNOWN',
      amount: parsedAmount,
      response_code: apiResponse.data.responseCode,
      response_reason: apiResponse.data.responseReason,
      txn_reference_id: txnList.txnReferenceId,
      ...restTxnList,
    }

    logBBPSApiCall(
      'transactionStatus',
      reqId,
      undefined,
      response.status,
      apiResponse.data.responseCode
    )

    return transactionStatus
  } catch (error: any) {
    logBBPSApiError('transactionStatus', reqId, error)
    throw error
  }
}

