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
  amount: number // Amount in RUPEES (not paise)
  agentTransactionId: string
  inputParams?: Array<{ paramName: string; paramValue: string | number }>
  name?: string
  subServiceName: string // REQUIRED: Category name (e.g., "Credit Card", "Electricity")
  initChannel?: string
  mac?: string
  custConvFee?: number // Number (not string) - e.g., 1
  billerAdhoc?: boolean // Boolean (not string) - e.g., true
  paymentInfo?: Array<{ infoName: string; infoValue: string }>
  paymentMode?: string // "Cash", "Account", "Wallet", "UPI"
  quickPay?: string // "Y" or "N"
  splitPay?: string // "Y" or "N"
  reqId?: string // CRITICAL: Must be reqId from fetchBill response
  customerMobileNumber?: string // NEW: Required for Wallet payment mode
  customerPan?: string // Required for payments above ₹49,999 (up to ₹2,00,000)
  billNumber?: string // Bill number from fetchBill response (required by Sparkup)
  billerResponse?: { // Bill details from fetchBill response - pass EXACTLY as returned by fetchBill
    billAmount?: string
    billDate?: string
    customerName?: string
    dueDate?: string
    [key: string]: any // Allow extra fields from fetchBill (don't lose any data)
  }
  additionalInfo?: Array<{ // Additional info from fetchBill response
    infoName: string
    infoValue: string
  }>
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
    CustConvFee?: string
    RespAmount?: string // Amount in paise
    RespBillDate?: string
    RespCustomerName?: string
    RespDueDate?: string
    approvalRefNumber?: string
    inputParams?: {
      input?: Array<{
        paramName: string
        paramValue: string
      }>
    }
    bbpsId?: string // BBPS transaction ID
    transaction_id?: string // UTR/Transaction ID
    status?: string
    txnRefId?: string
    transactionId?: string
    requestId?: string
    bill_amount?: string
    amount_paid?: string
    [key: string]: any
  }
}

/**
 * Pay bill request - PRODUCTION TESTED (Feb 2026)
 * 
 * IMPORTANT: Sparkup API expects amount in RUPEES (not paise).
 * For a ₹200 payment, send amount: 200 (NOT 20000).
 * 
 * PRODUCTION-TESTED JSON FORMAT (verified on Postman):
 * {
 *   "name": "Utility",
 *   "sub_service_name": "Credit Card",    // MUST be exact category name
 *   "initChannel": "AGT",
 *   "amount": 100,                        // Number in RUPEES (NOT paise, NOT string)
 *   "billerId": "ICIC00000NATSI",
 *   "billerName": "ICICI Credit Card",    // REQUIRED
 *   "inputParams": [{ "paramName": "...", "paramValue": "..." }],
 *   "mac": "01-23-45-67-89-ab",
 *   "custConvFee": 1,                     // Number (NOT string)
 *   "billerAdhoc": true,                  // Boolean (NOT string)
 *   "paymentInfo": [{ "infoName": "Payment Account Info", "infoValue": "Cash Payment" }],
 *   "paymentMode": "Cash",
 *   "quickPay": "N",
 *   "splitPay": "N",
 *   "reqId": "...",                       // MUST match fetchBill reqId
 *   "billerResponse": { "billAmount": "...", "billDate": "...", "customerName": "...", "dueDate": "..." },
 *   "additionalInfo": [{ "infoName": "...", "infoValue": "..." }]
 * }
 * 
 * @param params - Payment request parameters
 * @returns Payment response with transaction ID
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
    custConvFee = 1, // Number (not string) - default 1 as per tested API
    billerAdhoc = true, // Boolean (not string) - default true as per tested API
    paymentInfo = [],
    paymentMode = 'Cash', // Per API docs: "Cash", "Account", "Wallet", "UPI"
    quickPay = 'N', // "N" for non-quick pay (bill fetch was done) - as per tested API
    splitPay = 'N',
    reqId: providedReqId,
    customerMobileNumber, // NEW: Required for Wallet payment mode
    customerPan, // Required for payments above ₹49,999
    billNumber, // Bill number from fetchBill response
    billerResponse, // Bill details from fetchBill response
    additionalInfo, // Additional info from fetchBill response
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
    } else if (mode === 'UPI') {
      // UPI mode requires VPA (Virtual Payment Address)
      // Look for VPA in provided paymentInfo from frontend
      const vpaInfo = paymentInfo.find(p => p.infoName === 'VPA')
      if (vpaInfo) {
        effectivePaymentInfo = [{ infoName: 'VPA', infoValue: vpaInfo.infoValue }]
      } else {
        effectivePaymentInfo = paymentInfo.length > 0 ? paymentInfo : [
          { infoName: 'VPA', infoValue: '' }
        ]
      }
    } else {
      // Default to Cash format
      effectivePaymentInfo = [
        { infoName: 'Payment Account Info', infoValue: 'Cash Payment' }
      ]
    }
    
    // NOTE: Do NOT allow frontend paymentInfo to override!
    // The format MUST match Sparkup documentation exactly or you get "Invalid XML request" error

    // ========================================
    // Build request body - EXACT format matching PRODUCTION-TESTED Postman request (Feb 2026)
    // IMPORTANT: Only include fields that are in the working Postman request!
    // Extra fields can cause Sparkup to reject the request.
    //
    // Working Postman format:
    // {
    //   "name": "Utility",
    //   "sub_service_name": "Credit Card",
    //   "initChannel": "AGT",
    //   "amount": 100,
    //   "billerId": "ICIC00000NATSI",
    //   "billerName": "ICICI Credit Card",
    //   "inputParams": [{ "paramName": "...", "paramValue": "..." }],
    //   "mac": "01-23-45-67-89-ab",
    //   "custConvFee": 1,
    //   "billerAdhoc": true,
    //   "paymentInfo": [{ "infoName": "Payment Account Info", "infoValue": "Cash Payment" }],
    //   "paymentMode": "Cash",
    //   "quickPay": "N",
    //   "splitPay": "N",
    //   "reqId": "6B9F2O2NGQ80B68O61DNHEMP11560411430",
    //   "billerResponse": { "billAmount": "29899958", "billDate": "...", "customerName": "...", "dueDate": "..." },
    //   "additionalInfo": [{ "infoName": "...", "infoValue": "..." }]
    // }
    // ========================================
    
    // CRITICAL: Clean billerResponse to ONLY include the 4 fields from working Postman format
    // Extra fields (billNumber, billPeriod, amountOptions, message, etc.) can cause rejection
    let cleanBillerResponse: any = undefined
    if (billerResponse) {
      cleanBillerResponse = {
        billAmount: String(billerResponse.billAmount || ''),
        billDate: billerResponse.billDate || '',
        customerName: billerResponse.customerName || '',
        dueDate: billerResponse.dueDate || '',
      }
      // Remove empty string fields to match Postman (only include fields that have values)
      Object.keys(cleanBillerResponse).forEach(key => {
        if (!cleanBillerResponse[key]) {
          delete cleanBillerResponse[key]
        }
      })
    }
    
    // CRITICAL: Ensure additionalInfo is a FLAT array of {infoName, infoValue}
    // NOT wrapped in { info: [...] } - must match Postman format exactly
    let cleanAdditionalInfo: Array<{ infoName: string; infoValue: string }> | undefined
    if (additionalInfo && Array.isArray(additionalInfo) && additionalInfo.length > 0) {
      cleanAdditionalInfo = additionalInfo
        .filter((item: any) => item && item.infoName && typeof item.infoName === 'string')
        .map((item: any) => ({
          infoName: String(item.infoName),
          infoValue: String(item.infoValue || ''),
        }))
    }
    
    // CRITICAL: Ensure inputParams is a FLAT array of {paramName, paramValue}
    // Values must be strings to match Postman format
    const cleanInputParams = requestInputParams.map((p: any) => ({
      paramName: String(p.paramName),
      paramValue: String(p.paramValue),
    }))
    
    const requestBody: any = {
      name: name || 'Utility',
      sub_service_name: subServiceName,                                   // MUST be exact category name
      initChannel: initChannel || 'AGT',
      amount: amount,                                                      // Number in RUPEES (NOT string, NOT paise)
      billerId,
      billerName: billerName || '',                                        // REQUIRED per Sparkup API
      inputParams: cleanInputParams,                                       // Clean array of { paramName, paramValue }
      mac: mac || '01-23-45-67-89-ab',
      custConvFee: typeof custConvFee === 'number' ? custConvFee : 1,      // Number (NOT string)
      billerAdhoc: typeof billerAdhoc === 'boolean' ? billerAdhoc : true,  // Boolean (NOT string)
      paymentInfo: effectivePaymentInfo,                                   // Format depends on paymentMode
      paymentMode: paymentMode || 'Cash',                                  // "Cash" is production-tested default
      quickPay: quickPay || 'N',
      splitPay: splitPay || 'N',
      reqId,                                                               // CRITICAL: Must match fetchBill reqId
    }
    
    // Include customerPan for payments above ₹49,999 (Sparkup requires it for amounts ≥ ₹50,000)
    if (customerPan && customerPan.trim() !== '') {
      requestBody.customerPan = customerPan.trim().toUpperCase()
    }

    // Include CLEANED billerResponse (only billAmount, billDate, customerName, dueDate)
    if (cleanBillerResponse && Object.keys(cleanBillerResponse).length > 0) {
      requestBody.billerResponse = cleanBillerResponse
    }
    
    // Include CLEANED additionalInfo (flat array only)
    if (cleanAdditionalInfo && cleanAdditionalInfo.length > 0) {
      requestBody.additionalInfo = cleanAdditionalInfo
    }
    
    // NOTE: billNumber is NOT included - it's not in the working Postman format
    // Including extra fields can cause Sparkup to reject the request

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
    
    // Make API request (with one retry on transient "technical issues" from Sparkup)
    let response = await bbpsClient.request<BBPSPayRequestResponse>({
      method: 'POST',
      endpoint: '/bbps/payRequest',
      body: requestBody,
      reqId,
      billerId,
      includeAuthToken: false,
    })

    // Retry once if Sparkup returns a transient "technical issues" error
    const isTransientError = !response.success &&
      (response.error?.includes('technical issues') || response.error?.includes('try again'))
    if (isTransientError) {
      console.warn(`[BBPS payRequest] Transient error from Sparkup, retrying in 3s... (${response.error})`)
      await new Promise(r => setTimeout(r, 3000))
      response = await bbpsClient.request<BBPSPayRequestResponse>({
        method: 'POST',
        endpoint: '/bbps/payRequest',
        body: requestBody,
        reqId,
        billerId,
        includeAuthToken: false,
      })
    }

    const apiResponse = response.data

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

    // Transform successful response - handle new response structure
    // Response amounts are in PAISE (e.g., "10000" = ₹100)
    const parseResponseAmount = (amountStr: string | undefined): number => {
      if (!amountStr) return 0
      const cleaned = String(amountStr).replace(/[,\s₹]/g, '')
      const parsed = parseFloat(cleaned)
      return isNaN(parsed) ? 0 : parsed
    }
    
    const paymentResponse: BBPSPaymentResponse = {
      success: true,
      transaction_id:
        responseData.transaction_id || // UTR/Transaction ID (primary)
        responseData.bbpsId || // BBPS transaction ID (fallback)
        responseData.txnRefId ||
        responseData.transactionId,
      agent_transaction_id: agentTransactionId,
      status: responseData.status || 'success',
      payment_status: responseData.responseReason || responseData.status || 'SUCCESS',
      bill_amount: parseResponseAmount(
        responseData.RespAmount || // Amount in paise from response
        responseData.bill_amount
      ),
      amount_paid: parseResponseAmount(
        responseData.RespAmount || // Amount in paise from response
        responseData.amount_paid
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

