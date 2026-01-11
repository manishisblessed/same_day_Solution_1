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
  paymentInfo?: Array<{ infoName: string; infoValue: string }>
  paymentMode?: string
}

/**
 * Response from BBPS API
 */
interface BBPSFetchBillResponse {
  success: boolean
  status?: string
  message?: string
  error?: string
  reqId?: string
  data?: {
    responseCode?: string
    responseReason?: string
    message?: string
    error?: string
    errorMessage?: string
    error_message?: string
    inputParams?: {
      input?: Array<{
        paramName: string
        paramValue: string
      }>
    }
    billerResponse?: {
      billAmount?: string | number
      dueDate?: string
      billDate?: string
      billNumber?: string
      billPeriod?: string
      customerName?: string
      consumerName?: string
      message?: string
      errorMessage?: string
      amountOptions?: any
      [key: string]: any
    }
    additionalInfo?: {
      info?: Array<{
        infoName: string
        infoValue: string
      }>
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
    paymentInfo,
    paymentMode,
  } = params
  const reqId = generateReqId()

  // Validate input
  if (!billerId || billerId.trim() === '') {
    throw new Error('Biller ID is required')
  }
  
  // Consumer number is required only if inputParams are not provided
  if (!inputParams || inputParams.length === 0) {
    if (!consumerNumber || consumerNumber.trim() === '') {
      throw new Error('Consumer number is required when input parameters are not provided')
    }
  } else {
    // If inputParams are provided, validate they have values
    const emptyParams = inputParams.filter(p => !p.paramValue || String(p.paramValue).trim() === '')
    if (emptyParams.length > 0) {
      throw new Error(`Input parameters are required: ${emptyParams.map(p => p.paramName).join(', ')}`)
    }
    // consumerNumber can be empty when inputParams are provided - it's just for backward compatibility
  }

  // Use mock data if enabled
  if (isMockMode()) {
    logBBPSApiCall('fetchBill', reqId, billerId, 'MOCK')
    console.log('[BBPS Mock] Fetching bill with params:', {
      billerId,
      consumerNumber,
      inputParams,
    })
    const mockBill = getMockBillDetails(billerId, consumerNumber, inputParams)
    return { ...mockBill, reqId }
  }

  try {
    // Build inputParams array
    // If inputParams are provided, use them; otherwise create from consumerNumber
    const requestInputParams = inputParams && inputParams.length > 0 
      ? inputParams 
      : [
          {
            paramName: 'Consumer Number',
            paramValue: consumerNumber || '',
          },
        ]

    console.log('[BBPS] Fetching bill with inputParams:', requestInputParams)
    console.log('[BBPS] Consumer number:', consumerNumber)

    // Build query parameters
    const queryParams = new URLSearchParams()
    queryParams.append('reqId', reqId)
    queryParams.append('billerId', billerId)
    
    // Add inputParams as array query parameters
    requestInputParams.forEach((param, index) => {
      queryParams.append(`inputParams[${index}][paramName]`, param.paramName)
      queryParams.append(`inputParams[${index}][paramValue]`, String(param.paramValue))
    })
    
    queryParams.append('initChannel', initChannel)
    
    // Add paymentInfo if provided
    if (paymentInfo && paymentInfo.length > 0) {
      paymentInfo.forEach((info, index) => {
        queryParams.append(`paymentInfo[${index}][infoName]`, info.infoName)
        queryParams.append(`paymentInfo[${index}][infoValue]`, info.infoValue)
      })
    }
    
    // Add paymentMode if provided
    if (paymentMode) {
      queryParams.append('paymentMode', paymentMode)
    }

    // Build endpoint with query parameters
    const endpoint = `/bbps/fetchBill?${queryParams.toString()}`

    // Make API request (empty body as per API spec)
    const response = await bbpsClient.request<BBPSFetchBillResponse>({
      method: 'POST',
      endpoint,
      body: undefined,
      reqId,
      billerId,
    })

    if (!response.success || !response.data) {
      logBBPSApiError('fetchBill', reqId, response.error || 'Unknown error', billerId)
      throw new Error(response.error || 'Failed to fetch bill details')
    }

    const apiResponse = response.data

    // Log full response for debugging
    console.log('[BBPS fetchBill] Full API response:', JSON.stringify(apiResponse, null, 2))

    // Check if API returned an error (success: false)
    if (apiResponse.success === false) {
      // Extract error message from various possible locations in the response
      // Priority: errorInfo.error.errorMessage > data.errorMessage > message > error
      const errorMessage = 
        apiResponse.data?.errorInfo?.error?.errorMessage ||
        apiResponse.data?.errorInfo?.errorMessage ||
        apiResponse.data?.errorMessage ||
        apiResponse.data?.message ||
        apiResponse.message || 
        apiResponse.error || 
        'Bill fetch failed'
      
      // Also extract error code if available
      const errorCode = 
        apiResponse.data?.errorInfo?.error?.errorCode ||
        apiResponse.data?.errorCode ||
        apiResponse.data?.responseCode ||
        'UNKNOWN'
      
      const fullErrorMessage = errorCode !== 'UNKNOWN' 
        ? `${errorMessage} (Error Code: ${errorCode})`
        : errorMessage
      
      logBBPSApiError('fetchBill', reqId, fullErrorMessage, billerId)
      throw new Error(errorMessage) // Throw user-friendly message without error code
    }

    // Validate response structure
    if (!apiResponse.data) {
      const errorMessage = 
        apiResponse.message || 
        'Invalid response structure: missing data field'
      logBBPSApiError('fetchBill', reqId, errorMessage, billerId)
      throw new Error(errorMessage)
    }

    // Check responseCode - '000' means success, anything else is an error
    const responseCode = apiResponse.data.responseCode
    if (responseCode && responseCode !== '000') {
      // Extract error message from various possible locations
      // Priority: errorInfo.error.errorMessage > errorMessage > message > responseReason
      const errorMessage = 
        apiResponse.data.errorInfo?.error?.errorMessage ||
        apiResponse.data.errorInfo?.errorMessage ||
        apiResponse.data.errorMessage ||
        apiResponse.data.error_message ||
        apiResponse.data.message ||
        apiResponse.data.responseReason ||
        apiResponse.message ||
        (apiResponse.data.billerResponse?.errorMessage) ||
        (apiResponse.data.billerResponse?.message) ||
        `Bill fetch failed with response code: ${responseCode}`
      
      // Extract error code if available
      const errorCode = 
        apiResponse.data.errorInfo?.error?.errorCode ||
        apiResponse.data.errorCode ||
        responseCode
      
      console.log('[BBPS fetchBill] Error detected:', {
        responseCode,
        errorCode,
        errorMessage,
        fullResponse: apiResponse
      })
      
      logBBPSApiError('fetchBill', reqId, errorMessage, billerId)
      throw new Error(errorMessage)
    }

    const billerResponse = apiResponse.data.billerResponse || {}
    const responseInputParams = apiResponse.data.inputParams
    const additionalInfo = apiResponse.data.additionalInfo

    // Helper function to parse amount string (removes commas and formatting)
    // IMPORTANT: BBPS API returns amounts in paise - keep it in paise, don't convert to rupees
    // Conversion to rupees should only happen at the presentation layer (UI)
    const parseAmount = (amount: string | number | undefined): number => {
      if (typeof amount === 'number') return amount
      if (!amount) return 0
      // Remove commas, spaces, and other formatting characters
      const cleaned = String(amount).replace(/[,\s₹]/g, '')
      const parsed = parseFloat(cleaned)
      return isNaN(parsed) ? 0 : parsed
    }

    // Transform API response to BBPSBillDetails format
    // bill_amount is stored in paise (as returned by API) - convert to rupees only for display
    
    // Extract consumer name from multiple possible locations and field name variations
    const consumerName = 
      billerResponse.customerName ||
      billerResponse.customer_name ||
      billerResponse.consumerName ||
      billerResponse.consumer_name ||
      billerResponse.name ||
      billerResponse.customerName ||
      (additionalInfo as any)?.customerName ||
      (additionalInfo as any)?.customer_name ||
      (additionalInfo as any)?.consumerName ||
      apiResponse.data?.customerName ||
      apiResponse.data?.customer_name ||
      apiResponse.data?.consumerName ||
      undefined
    
    // Log the actual response structure for debugging
    if (!consumerName || consumerName === 'AXXX' || consumerName.includes('XXX')) {
      console.log('[BBPS fetchBill] Consumer name not found or masked. Checking full response:', {
        billerResponseKeys: Object.keys(billerResponse),
        billerResponse: billerResponse,
        additionalInfoKeys: additionalInfo ? Object.keys(additionalInfo) : [],
        additionalInfo: additionalInfo,
        apiResponseDataKeys: Object.keys(apiResponse.data || {}),
        foundConsumerName: consumerName,
      })
    }
    
    const billDetails: BBPSBillDetails = {
      biller_id: billerId,
      consumer_number: consumerNumber,
      bill_amount: parseAmount(billerResponse.billAmount || billerResponse.amount), // Amount in paise
      due_date: billerResponse.dueDate || billerResponse.due_date,
      bill_date: billerResponse.billDate || billerResponse.bill_date,
      bill_number: billerResponse.billNumber || billerResponse.bill_number,
      consumer_name: consumerName,
      reqId: apiResponse.reqId || reqId,
      additional_info: {
        ...apiResponse.data,
        reqId: apiResponse.reqId || reqId,
        responseCode: apiResponse.data.responseCode,
        inputParams: responseInputParams,
        billerResponse: billerResponse,
        additionalInfo: additionalInfo,
        amountOptions: billerResponse.amountOptions,
        billPeriod: billerResponse.billPeriod || 'NA',
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

