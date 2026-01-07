/**
 * Fetch Bill Service
 * SparkUpTech BBPS API: POST /bbps/fetchBill
 * 
 * Fetches bill details for a consumer
 */

import { bbpsClient } from './bbpsClient'
import { generateReqId, logBBPSApiCall, logBBPSApiError } from './helpers'
import { isMockMode } from './config'
import { BBPSBillDetails } from './types'
import { getMockBillDetails } from './mocks/fetchBill'

/**
 * Request parameters for fetchBill
 */
export interface FetchBillParams {
  billerId: string
  consumerNumber: string
  inputParams?: Array<{ paramName: string; paramValue: string | number }>
  ip?: string
  initChannel?: string
  mac?: string
}

/**
 * Response from BBPS API
 */
interface BBPSFetchBillResponse {
  success: boolean
  status?: string
  message?: string
  reqId?: string
  data?: {
    responseCode?: string
    billerResponse?: {
      billAmount?: string | number
      dueDate?: string
      billDate?: string
      billNumber?: string
      customerName?: string
      consumerName?: string
      amountOptions?: any
      billPeriod?: string
      [key: string]: any
    }
    [key: string]: any
  }
}

/**
 * Fetch bill details
 * 
 * @param params - Biller ID, consumer number, and optional parameters
 * @returns Bill details including amount, due date, etc.
 * 
 * @example
 * ```typescript
 * const billDetails = await fetchBill({
 *   billerId: 'AEML00000NATD1',
 *   consumerNumber: '1234567890',
 *   inputParams: [
 *     { paramName: 'Consumer Number', paramValue: '1234567890' }
 *   ]
 * })
 * ```
 */
export async function fetchBill(
  params: FetchBillParams
): Promise<BBPSBillDetails> {
  const {
    billerId,
    consumerNumber,
    inputParams,
    ip = '127.0.0.1',
    initChannel = 'AGT',
    mac = '01-23-45-67-89-ab',
  } = params
  const reqId = generateReqId()

  // Validate input
  if (!billerId || billerId.trim() === '') {
    throw new Error('Biller ID is required')
  }
  if (!consumerNumber || consumerNumber.trim() === '') {
    throw new Error('Consumer number is required')
  }

  // Use mock data if enabled
  if (isMockMode()) {
    logBBPSApiCall('fetchBill', reqId, billerId, 'MOCK')
    const mockBill = getMockBillDetails(billerId, consumerNumber)
    return { ...mockBill, reqId }
  }

  try {
    // Build inputParams array
    const requestInputParams = inputParams || [
      {
        paramName: 'Consumer Number',
        paramValue: consumerNumber,
      },
    ]

    // Prepare request body
    const requestBody = {
      ip,
      initChannel,
      mac,
      billerId,
      inputParams: requestInputParams,
    }

    // Make API request
    const response = await bbpsClient.request<BBPSFetchBillResponse>({
      method: 'POST',
      endpoint: '/bbps/fetchBill',
      body: requestBody,
      reqId,
      billerId,
    })

    if (!response.success || !response.data) {
      logBBPSApiError('fetchBill', reqId, response.error || 'Unknown error', billerId)
      throw new Error(response.error || 'Failed to fetch bill details')
    }

    const apiResponse = response.data

    // Validate response structure
    if (!apiResponse.success || !apiResponse.data) {
      throw new Error(apiResponse.message || 'Failed to fetch bill details')
    }

    const billerResponse = apiResponse.data.billerResponse || {}

    // Transform API response to BBPSBillDetails format
    const billDetails: BBPSBillDetails = {
      biller_id: billerId,
      consumer_number: consumerNumber,
      bill_amount: parseFloat(
        String(billerResponse.billAmount || billerResponse.amount || '0')
      ),
      due_date: billerResponse.dueDate || billerResponse.due_date,
      bill_date: billerResponse.billDate || billerResponse.bill_date,
      bill_number: billerResponse.billNumber || billerResponse.bill_number,
      consumer_name:
        billerResponse.customerName ||
        billerResponse.customer_name ||
        billerResponse.consumerName,
      reqId: apiResponse.reqId || reqId,
      additional_info: {
        ...apiResponse.data,
        reqId: apiResponse.reqId || reqId,
        responseCode: apiResponse.data.responseCode,
        amountOptions: billerResponse.amountOptions,
        billPeriod: billerResponse.billPeriod,
      },
    }

    logBBPSApiCall(
      'fetchBill',
      reqId,
      billerId,
      response.status,
      apiResponse.data.responseCode
    )

    return billDetails
  } catch (error: any) {
    logBBPSApiError('fetchBill', reqId, error, billerId)
    throw error
  }
}

