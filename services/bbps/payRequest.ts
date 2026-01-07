/**
 * Pay Request Service
 * SparkUpTech BBPS API: POST /bbps/payRequest
 * 
 * Processes bill payment through BBPS
 */

import { bbpsClient } from './bbpsClient'
import { generateReqId, logBBPSApiCall, logBBPSApiError } from './helpers'
import { isMockMode } from './config'
import { BBPSPaymentRequest, BBPSPaymentResponse } from './types'
import { getMockPayRequest } from './mocks/payRequest'

/**
 * Request parameters for payRequest
 */
export interface PayRequestParams {
  billerId: string
  consumerNumber: string
  amount: number
  agentTransactionId: string
  inputParams?: Array<{ paramName: string; paramValue: string | number }>
  name?: string
  subServiceName?: string
  initChannel?: string
  mac?: string
  custConvFee?: string
  billerAdhoc?: string
  paymentInfo?: any[]
  paymentMode?: string
  quickPay?: string
  splitPay?: string
  additionalInfo?: Record<string, any>
  billerResponse?: Record<string, any>
  reqId?: string
}

/**
 * Response from BBPS API
 */
interface BBPSPayRequestResponse {
  success: boolean
  status?: string
  message?: string
  data?: {
    responseCode?: string
    responseReason?: string
    txnRefId?: string
    transaction_id?: string
    transactionId?: string
    requestId?: string
    approvalRefNumber?: string
    RespAmount?: string
    bill_amount?: string
    amount_paid?: string
    [key: string]: any
  }
}

/**
 * Pay bill request
 * 
 * @param params - Payment request parameters
 * @returns Payment response with transaction ID
 * 
 * @example
 * ```typescript
 * const paymentResponse = await payRequest({
 *   billerId: 'AEML00000NATD1',
 *   consumerNumber: '1234567890',
 *   amount: 1000,
 *   agentTransactionId: 'BBPS-123-1234567890-ABC',
 *   inputParams: [
 *     { paramName: 'Consumer Number', paramValue: '1234567890' }
 *   ]
 * })
 * ```
 */
export async function payRequest(
  params: PayRequestParams
): Promise<BBPSPaymentResponse> {
  const {
    billerId,
    consumerNumber,
    amount,
    agentTransactionId,
    inputParams,
    name = 'Utility',
    subServiceName = 'BBPS Bill payment',
    initChannel = 'AGT',
    mac = '01-23-45-67-89-ab',
    custConvFee = '0.00',
    billerAdhoc = '0.00',
    paymentInfo = [],
    paymentMode = 'Wallet',
    quickPay = 'Y',
    splitPay = 'N',
    additionalInfo = {},
    billerResponse = {},
    reqId: providedReqId,
  } = params
  const reqId = providedReqId || generateReqId()

  // Validate input
  if (!billerId || billerId.trim() === '') {
    throw new Error('Biller ID is required')
  }
  if (!consumerNumber || consumerNumber.trim() === '') {
    throw new Error('Consumer number is required')
  }
  if (!amount || amount <= 0) {
    throw new Error('Amount must be greater than 0')
  }
  if (!agentTransactionId || agentTransactionId.trim() === '') {
    throw new Error('Agent transaction ID is required')
  }

  // Use mock data if enabled
  if (isMockMode()) {
    logBBPSApiCall('payRequest', reqId, billerId, 'MOCK')
    const mockPayment: BBPSPaymentRequest = {
      biller_id: billerId,
      consumer_number: consumerNumber,
      amount,
      agent_transaction_id: agentTransactionId,
      additional_info: additionalInfo,
      reqId,
    }
    return getMockPayRequest(mockPayment)
  }

  try {
    // Build inputParams array
    const requestInputParams =
      inputParams ||
      [
        {
          paramName: 'Consumer Number',
          paramValue: consumerNumber,
        },
      ]

    // Prepare request body
    const requestBody = {
      name,
      sub_service_name: subServiceName,
      initChannel,
      amount: amount.toString(),
      billerId,
      inputParams: requestInputParams,
      mac,
      custConvFee,
      billerAdhoc,
      paymentInfo,
      paymentMode,
      quickPay,
      splitPay,
      additionalInfo,
      billerResponse,
      reqId,
    }

    // Make API request
    const response = await bbpsClient.request<BBPSPayRequestResponse>({
      method: 'POST',
      endpoint: '/bbps/payRequest',
      body: requestBody,
      reqId,
      billerId,
    })

    const apiResponse = response.data

    // Handle error response
    if (!response.success || !apiResponse) {
      logBBPSApiError('payRequest', reqId, response.error || 'Unknown error', billerId)
      return {
        success: false,
        error_code: 'PAYMENT_FAILED',
        error_message: response.error || 'Payment request failed',
        agent_transaction_id: agentTransactionId,
        reqId,
      }
    }

    // Check if payment was successful
    const responseData = apiResponse.data || {}
    const isSuccess =
      response.success &&
      apiResponse.success &&
      apiResponse.status === 'success' &&
      responseData.responseCode === '000'

    if (!isSuccess) {
      return {
        success: false,
        error_code:
          responseData.responseCode ||
          responseData.error_code ||
          responseData.errorCode ||
          apiResponse.status?.toString() ||
          'PAYMENT_FAILED',
        error_message:
          responseData.responseReason ||
          apiResponse.message ||
          responseData.error_message ||
          responseData.errorMessage ||
          'Payment failed',
        agent_transaction_id: agentTransactionId,
        reqId,
      }
    }

    // Transform successful response
    const paymentResponse: BBPSPaymentResponse = {
      success: true,
      transaction_id:
        responseData.txnRefId ||
        responseData.transaction_id ||
        responseData.transactionId,
      agent_transaction_id: agentTransactionId,
      status: 'success',
      payment_status: responseData.responseReason || 'SUCCESS',
      bill_amount: parseFloat(
        responseData.RespAmount ||
          responseData.bill_amount ||
          amount.toString()
      ),
      amount_paid: parseFloat(
        responseData.RespAmount ||
          responseData.amount_paid ||
          amount.toString()
      ),
      reqId,
    }

    logBBPSApiCall(
      'payRequest',
      reqId,
      billerId,
      response.status,
      responseData.responseCode
    )

    return paymentResponse
  } catch (error: any) {
    logBBPSApiError('payRequest', reqId, error, billerId)
    return {
      success: false,
      error_message: error.message || 'Payment request failed',
      agent_transaction_id: agentTransactionId,
      reqId,
    }
  }
}

