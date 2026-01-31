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
    quickPay = 'Y',
    splitPay = 'N',
    reqId: providedReqId,
    customerMobileNumber, // NEW: Required for Wallet payment mode
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

    // Build paymentInfo based on payment mode (per Sparkup API update Jan 2026)
    // Cash: { infoName: "Payment Account Info", infoValue: "Cash Payment" }
    // Wallet: { infoName: "WalletName", infoValue: "Wallet" }, { infoName: "MobileNo", infoValue: "<mobile>" }
    let effectivePaymentInfo: Array<{ infoName: string; infoValue: string }> = []
    
    if (paymentMode === 'Cash') {
      effectivePaymentInfo = [
        { infoName: 'Payment Account Info', infoValue: 'Cash Payment' }
      ]
    } else if (paymentMode === 'Wallet') {
      effectivePaymentInfo = [
        { infoName: 'WalletName', infoValue: 'Wallet' },
        { infoName: 'MobileNo', infoValue: customerMobileNumber || consumerNumber }
      ]
    } else if (paymentInfo.length > 0) {
      // Use provided paymentInfo for other modes
      effectivePaymentInfo = paymentInfo
    } else {
      // Default fallback
      effectivePaymentInfo = [{ infoName: 'Remarks', infoValue: 'Received' }]
    }

    // Prepare request body (matching API specification exactly)
    // Per Sparkup API docs - only send fields that are in the spec
    const requestBody: any = {
      name,
      sub_service_name: subServiceName, // MUST be category name like "Credit Card", "Electricity"
      initChannel,
      amount: amount.toString(),
      billerId,
      billerName, // NEW: Required per Sparkup API update (Jan 2026)
      inputParams: requestInputParams,
      mac,
      custConvFee,
      billerAdhoc, // Must be "true" or "false" (string)
      paymentInfo: effectivePaymentInfo, // Generated based on paymentMode
      paymentMode,
      quickPay,
      splitPay,
      reqId, // CRITICAL: Links payment to fetchBill
    }
    
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
    console.log('sub_service_name (category):', subServiceName)
    console.log('paymentMode:', paymentMode)
    console.log('paymentInfo:', JSON.stringify(effectivePaymentInfo, null, 2))
    console.log('billerAdhoc:', billerAdhoc)
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

