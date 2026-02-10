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
    reqId?: string
    totalAmount?: number | string
    serviceCharge?: number | string
    transactionAmount?: number | string
    referenceNo?: string
    transaction_id?: string
    status?: string
    remark?: string
    compalainRegisterDes?: any
    compalainRegisterStatus?: boolean
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

    const responseData = apiResponse.data

    // Parse amounts safely (handle both number and string formats)
    const parseAmount = (value: number | string | undefined): number => {
      if (typeof value === 'number') return value
      if (!value) return 0
      const cleaned = String(value).replace(/[,\s₹]/g, '')
      const parsed = parseFloat(cleaned)
      return isNaN(parsed) ? 0 : parsed
    }

    // Determine success status
    // Response format: status can be "success" or responseCode can be "000"
    const isSuccess = 
      responseData.status === 'success' ||
      responseData.status === 'SUCCESS' ||
      responseData.responseCode === '000'

    // Transform API response to BBPSTransactionStatus format
    // Handle both new format (tested API) and legacy format (txnList)
    const transactionStatus: BBPSTransactionStatus = {
      transaction_id: 
        responseData.transaction_id || // New format (primary)
        responseData.referenceNo || // BBPS reference number
        responseData.txnList?.txnReferenceId || // Legacy format
        transactionId, // Fallback
      status: 
        responseData.status || // New format (primary)
        responseData.txnList?.txnStatus || // Legacy format
        (isSuccess ? 'SUCCESS' : 'UNKNOWN'),
      payment_status: 
        responseData.status || // New format
        responseData.remark || // Remark field
        responseData.txnList?.txnStatus || // Legacy format
        responseData.responseReason || // Fallback
        'UNKNOWN',
      amount: 
        parseAmount(responseData.transactionAmount) || // New format (primary)
        parseAmount(responseData.totalAmount) || // Alternative
        parseAmount(responseData.txnList?.amount) || // Legacy format
        0,
      response_code: responseData.responseCode,
      response_reason: responseData.remark || responseData.responseReason,
      txn_reference_id: responseData.referenceNo || responseData.transaction_id,
      // Include additional fields from new response format
      totalAmount: parseAmount(responseData.totalAmount),
      serviceCharge: parseAmount(responseData.serviceCharge),
      transactionAmount: parseAmount(responseData.transactionAmount),
      referenceNo: responseData.referenceNo,
      remark: responseData.remark,
      compalainRegisterDes: responseData.compalainRegisterDes,
      compalainRegisterStatus: responseData.compalainRegisterStatus,
      reqId: responseData.reqId || reqId,
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

