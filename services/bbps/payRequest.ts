/**
 * Pay Request Service
 * SparkUpTech BBPS API: POST /bbps/payRequest
 * 
 * Processes bill payment through BBPS
 */

import { bbpsClient } from './bbpsClient'
import { generateReqId, logBBPSApiCall, logBBPSApiError } from './helpers'
import { isMockMode, getBBPSBaseUrl } from './config'
import { BBPSPaymentRequest, BBPSPaymentResponse } from './types'
import { getMockPayRequest } from './mocks/payRequest'

/**
 * Sanitize error messages to remove HTML (e.g., nginx error pages)
 * Returns a user-friendly message
 */
function sanitizeErrorMessage(message: string | undefined | null): string {
  if (!message) return 'Payment request failed'
  
  // Check if the message contains HTML (nginx error, etc.)
  const trimmed = message.trim()
  if (trimmed.includes('<html') || trimmed.includes('<!DOCTYPE') || trimmed.includes('<center>')) {
    // Extract error type from HTML
    if (trimmed.includes('504') || trimmed.includes('Gateway Time-out') || trimmed.includes('Gateway Timeout')) {
      return 'Payment request timed out. This does NOT mean the payment failed - please check your transaction history before retrying.'
    }
    if (trimmed.includes('502') || trimmed.includes('Bad Gateway')) {
      return 'Service temporarily unavailable. Please check transaction history and try again.'
    }
    if (trimmed.includes('503') || trimmed.includes('Service Unavailable')) {
      return 'Service is currently unavailable. Please try again later.'
    }
    // Generic HTML error
    return 'Server error occurred. Please check transaction history before retrying.'
  }
  
  return message
}

/**
 * Request parameters for payRequest
 */
export interface PayRequestParams {
  billerId: string
  billerName?: string // NEW: Required per Sparkup API update (Jan 2026)
  consumerNumber: string
  amount: number
  agentTransactionId: string
  inputParams?: Array<{ paramName: string; paramValue: string | number }>
  name?: string
  subServiceName: string // REQUIRED: Category name (e.g., "Credit Card", "Electricity")
  initChannel?: string
  mac?: string
  custConvFee?: string
  billerAdhoc?: string // "true" or "false"
  paymentInfo?: Array<{ infoName: string; infoValue: string }>
  paymentMode?: string // "Cash", "Account", "Wallet", "UPI"
  quickPay?: string // "Y" or "N"
  splitPay?: string // "Y" or "N"
  reqId?: string // CRITICAL: Must be reqId from fetchBill response
  customerMobileNumber?: string // NEW: Required for Wallet payment mode
  billNumber?: string // Bill number from fetchBill response (required by Sparkup)
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
 * IMPORTANT: Sparkup API expects amount in RUPEES (not paise).
 * For a ₹200 payment, send amount: 200 (NOT 20000).
 * 
 * @param params - Payment request parameters
 * @returns Payment response with transaction ID
 * 
 * @example
 * ```typescript
 * const paymentResponse = await payRequest({
 *   billerId: 'AEML00000NATD1',
 *   consumerNumber: '1234567890',
 *   amount: 200, // ₹200 in rupees (NOT paise)
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
    billerName, // NEW: Required per Sparkup API update (Jan 2026)
    consumerNumber,
    amount,
    agentTransactionId,
    inputParams,
    name = 'Utility',
    subServiceName, // REQUIRED: Must be category name (e.g., "Credit Card", "Electricity")
    initChannel = 'AGT',
    mac = '01-23-45-67-89-ab',
    custConvFee = '0',
    billerAdhoc = 'true', // Per API docs: "true" or "false" (string boolean)
    paymentInfo = [],
    paymentMode = 'Cash', // Per API docs: "Cash", "Account", "Wallet", "UPI"
    quickPay = 'N', // Per Sparkup sample: "N" for non-quick pay (bill fetch was done)
    splitPay = 'N',
    reqId: providedReqId,
    customerMobileNumber, // NEW: Required for Wallet payment mode
    billNumber, // Bill number from fetchBill response
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
  // NEW: Sparkup API requires billerName per Jan 2026 update
  if (!billerName || billerName.trim() === '') {
    throw new Error('billerName is required')
  }
  if (!subServiceName || subServiceName.trim() === '') {
    throw new Error('sub_service_name (category) is required - e.g., "Credit Card", "Electricity"')
  }
  
  // Validate sub_service_name is a valid category
  const validCategories = [
    'Broadband Postpaid', 'Cable TV', 'Clubs and Associations', 'Credit Card',
    'Donation', 'DTH', 'Education Fees', 'Electricity', 'Fastag', 'Gas',
    'Hospital', 'Hospital and Pathology', 'Housing Society', 'Insurance',
    'Landline Postpaid', 'Loan Repayment', 'LPG Gas', 'Mobile Postpaid',
    'Mobile Prepaid', 'Municipal Services', 'Municipal Taxes', 'Recurring Deposit',
    'Rental', 'Subscription', 'Water', 'NCMC Recharge', 'NPS', 'Prepaid meter'
  ]
  if (!validCategories.includes(subServiceName)) {
    console.warn(`[BBPS payRequest] Warning: sub_service_name "${subServiceName}" may not be a valid category`)
  }

  // Use mock data if enabled
  if (isMockMode()) {
    logBBPSApiCall('payRequest', reqId, billerId, 'MOCK')
    const mockPayment: BBPSPaymentRequest = {
      biller_id: billerId,
      consumer_number: consumerNumber,
      amount,
      agent_transaction_id: agentTransactionId,
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

    // Build paymentInfo - EXACTLY as per Sparkup API Documentation (Feb 2026)
    // IMPORTANT: DO NOT allow frontend to override this - must match exact documentation format
    // Reference: bbps.txt lines 6726-6745
    // 
    // For Cash mode:
    //   { "infoName": "Payment Account Info", "infoValue": "Cash Payment" }
    //
    // For Wallet mode:
    //   [{ "infoName": "WalletName", "infoValue": "Wallet" },
    //    { "infoName": "MobileNo", "infoValue": "<Customer Mobile>" }]
    //
    let effectivePaymentInfo: Array<{ infoName: string; infoValue: string }> = []
    
    const mode = paymentMode || 'Cash'
    if (mode === 'Cash') {
      // EXACT format from documentation line 6727-6732
      effectivePaymentInfo = [
        { infoName: 'Payment Account Info', infoValue: 'Cash Payment' }
      ]
    } else if (mode === 'Wallet') {
      // EXACT format from documentation line 6734-6745
      effectivePaymentInfo = [
        { infoName: 'WalletName', infoValue: 'Wallet' },
        { infoName: 'MobileNo', infoValue: customerMobileNumber || '' }
      ]
    } else {
      // Default to Cash format
      effectivePaymentInfo = [
        { infoName: 'Payment Account Info', infoValue: 'Cash Payment' }
      ]
    }
    
    // NOTE: Do NOT allow frontend paymentInfo to override!
    // The format MUST match Sparkup documentation exactly or you get "Invalid XML request" error

    // Prepare request body - EXACT format that WORKED in testing (Feb 2026)
    // Reference: User's working example that returned "Fund Issue" (correct format, just balance issue)
    const requestBody: any = {
      name: name || 'Utility',
      sub_service_name: subServiceName, // MUST be exact category name (e.g., "Credit Card", "Electricity")
      initChannel: initChannel || 'AGT',
      amount: amount.toString(),
      billerId,
      billerName: billerName || '', // REQUIRED - biller name
      inputParams: requestInputParams,
      mac: mac || '01-23-45-67-89-ab',
      custConvFee: custConvFee || '0',
      billerAdhoc: billerAdhoc || 'true', // Must be string "true" or "false"
      paymentInfo: effectivePaymentInfo, // Format depends on paymentMode (see above)
      paymentMode: paymentMode || 'Cash',
      quickPay: 'Y',  // ALWAYS "Y" - the working example showed "Y"
      splitPay: splitPay || 'N',
      reqId, // CRITICAL: Unique request ID that links to fetchBill
    }
    
    // billNumber: Only include if available from fetchBill response
    // NOT all billers return billNumber (e.g., ICICI Credit Card doesn't)
    // Only add if we have a real value - don't send empty string
    if (billNumber && billNumber.trim() !== '') {
      requestBody.billNumber = billNumber
      console.log('Including billNumber in request:', billNumber)
    } else {
      console.log('No billNumber available from fetchBill - omitting from request')
    }
    
    // Remove any undefined or null values
    Object.keys(requestBody).forEach(key => {
      if (requestBody[key] === undefined || requestBody[key] === null) {
        delete requestBody[key]
      }
    })
    
    // NOTE: Do NOT send additionalInfo or billerResponse - they are NOT in the API spec

    // PayRequest endpoint: /api/ba/bbps/payRequest (same base URL as other endpoints)
    // According to API docs, it uses the same headers (partnerid, consumerkey, consumersecret)
    // No Authorization Bearer token required per API documentation
    
    // 🔍 LOG FULL REQUEST BODY BEING SENT TO SPARKUP
    console.log('=== SPARKUP PAY REQUEST - FULL REQUEST ===')
    console.log('Endpoint: POST /bbps/payRequest')
    console.log('reqId being sent:', reqId)
    console.log('billerId:', billerId)
    console.log('billerName:', billerName)
    console.log('billNumber:', billNumber)
    console.log('sub_service_name (category):', subServiceName)
    console.log('paymentMode:', paymentMode)
    console.log('paymentInfo:', JSON.stringify(effectivePaymentInfo, null, 2))
    console.log('billerAdhoc:', billerAdhoc)
    console.log('quickPay:', quickPay)
    console.log('splitPay:', splitPay)
    console.log('Full Request Body:', JSON.stringify(requestBody, null, 2))
    console.log('===========================================')
    
    // Make API request
    const response = await bbpsClient.request<BBPSPayRequestResponse>({
      method: 'POST',
      endpoint: '/bbps/payRequest',
      body: requestBody,
      reqId,
      billerId,
      includeAuthToken: false, // API docs show same headers as other endpoints, no Bearer token
    })

    const apiResponse = response.data

    // 🔍 DETAILED LOGGING: Log full Sparkup API response for debugging
    console.log('=== SPARKUP PAY REQUEST RESPONSE ===')
    console.log('Request ID:', reqId)
    console.log('Biller ID:', billerId)
    console.log('Amount (₹):', amount)
    console.log('HTTP Status:', response.status)
    console.log('Response Success:', response.success)
    console.log('Full API Response:', JSON.stringify(apiResponse, null, 2))
    console.log('=====================================')

    // Handle error response
    if (!response.success || !apiResponse) {
      console.error('❌ SPARKUP ERROR: No response or request failed')
      console.error('Error:', response.error)
      logBBPSApiError('payRequest', reqId, response.error || 'Unknown error', billerId)
      return {
        success: false,
        error_code: 'PAYMENT_FAILED',
        error_message: sanitizeErrorMessage(response.error),
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

    // 🔍 Log success check details
    console.log('=== SPARKUP PAYMENT STATUS CHECK ===')
    console.log('response.success:', response.success)
    console.log('apiResponse.success:', apiResponse.success)
    console.log('apiResponse.status:', apiResponse.status)
    console.log('apiResponse.message:', apiResponse.message)
    console.log('responseData.responseCode:', responseData.responseCode)
    console.log('responseData.responseReason:', responseData.responseReason)
    console.log('isSuccess:', isSuccess)
    console.log('====================================')

    if (!isSuccess) {
      console.error('❌ SPARKUP PAYMENT FAILED')
      console.error('Error Code:', responseData.responseCode || apiResponse.status)
      console.error('Error Message:', responseData.responseReason || apiResponse.message)
      console.error('Full Error Response:', JSON.stringify(apiResponse, null, 2))
      console.error('Request reqId was:', reqId)
      
      // Get error message and sanitize to remove any HTML
      const rawErrorMessage = 
        responseData.responseReason ||
        apiResponse.message ||
        responseData.error_message ||
        responseData.errorMessage ||
        'Payment failed'
      
      return {
        success: false,
        error_code:
          responseData.responseCode ||
          responseData.error_code ||
          responseData.errorCode ||
          apiResponse.status?.toString() ||
          'PAYMENT_FAILED',
        error_message: sanitizeErrorMessage(rawErrorMessage),
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
      error_message: sanitizeErrorMessage(error.message),
      agent_transaction_id: agentTransactionId,
      reqId,
    }
  }
}

