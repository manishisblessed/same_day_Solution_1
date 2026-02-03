/**
 * Initiate Bank Transfer
 * SparkUpTech Express Pay Payout API: POST /expressPay2
 * 
 * Initiates IMPS/NEFT transfer to bank account
 */

import { payoutClient } from './payoutClient'
import { TransferRequest, TransferResponse, ExpressPayRequestBody } from './types'
import { isPayoutMockMode, getPayoutCharges, getTransferLimits } from './config'

/**
 * Generate unique API Request ID (numeric, 16 digits)
 */
export function generateAPIRequestId(): number {
  // Generate a 16-digit numeric ID
  const timestamp = Date.now()
  const random = Math.floor(Math.random() * 10000)
  return parseInt(`${timestamp}${random}`.slice(0, 16))
}

/**
 * Generate unique client reference ID (string format for internal use)
 */
export function generateClientRefId(retailerId: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `PAY-${retailerId}-${timestamp}-${random}`
}

/**
 * Initiate bank transfer via expressPay2 API
 * 
 * @param request - Transfer details
 * @returns Transfer result
 */
export async function initiateTransfer(request: TransferRequest): Promise<{
  success: boolean
  transaction_id?: string
  client_ref_id?: number
  status?: 'pending' | 'success' | 'failed' | 'processing'
  amount?: number
  charges?: number
  total_amount?: number
  remark?: string
  error?: string
}> {
  const { 
    accountNumber, 
    ifscCode, 
    accountHolderName, 
    amount, 
    transferMode,
    bankId,
    bankName,
    beneficiaryMobile,
    senderName,
    senderMobile,
    senderEmail,
    remarks,
    clientRefId,
    webhookUrl
  } = request

  // Validate required inputs
  if (!accountNumber || !ifscCode || !accountHolderName || !amount || !transferMode) {
    return {
      success: false,
      error: 'Account number, IFSC, account holder name, amount, and transfer mode are required',
    }
  }

  if (!bankId || !bankName) {
    return {
      success: false,
      error: 'Bank ID and bank name are required',
    }
  }

  if (!beneficiaryMobile || !senderName || !senderMobile) {
    return {
      success: false,
      error: 'Beneficiary mobile, sender name, and sender mobile are required',
    }
  }

  // Normalize account number (remove spaces, keep only digits)
  const normalizedAccountNumber = accountNumber.replace(/\s+/g, '').trim()
  
  // Validate account number (must be 9-18 digits)
  if (!/^\d{9,18}$/.test(normalizedAccountNumber)) {
    return {
      success: false,
      error: 'Invalid account number. Must be 9-18 digits only.',
    }
  }

  // Normalize IFSC code (uppercase, remove spaces)
  const normalizedIfsc = ifscCode.replace(/\s+/g, '').trim().toUpperCase()
  
  // Validate IFSC (11 characters)
  const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/
  if (!ifscRegex.test(normalizedIfsc)) {
    return {
      success: false,
      error: 'Invalid IFSC code format. Expected format: ABCD0123456',
    }
  }

  // Normalize mobile numbers (remove spaces)
  const normalizedBeneficiaryMobile = beneficiaryMobile.replace(/\s+/g, '').trim()
  const normalizedSenderMobile = senderMobile.replace(/\s+/g, '').trim()

  // Validate mobile numbers (10 digits)
  const mobileRegex = /^[6-9]\d{9}$/
  if (!mobileRegex.test(normalizedBeneficiaryMobile)) {
    return {
      success: false,
      error: 'Invalid beneficiary mobile number',
    }
  }
  if (!mobileRegex.test(normalizedSenderMobile)) {
    return {
      success: false,
      error: 'Invalid sender mobile number',
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

  // Generate API Request ID (16-digit numeric)
  const apiRequestId = generateAPIRequestId()

  // Mock mode
  if (isPayoutMockMode()) {
    // Simulate some failures for testing
    if (normalizedAccountNumber.startsWith('999')) {
      return {
        success: false,
        error: 'Bank server temporarily unavailable',
      }
    }
    
    return {
      success: true,
      transaction_id: 'UTR' + Date.now(),
      client_ref_id: apiRequestId,
      status: 'pending',
      amount,
      charges,
      total_amount: amount,
      remark: `Amount of ${amount} is pending`,
    }
  }

  try {
    // Build request body matching API specification exactly
    const requestBody: ExpressPayRequestBody = {
      AccountNo: normalizedAccountNumber,
      AmountR: amount,
      APIRequestID: apiRequestId,
      BankID: bankId,
      BeneMobile: normalizedBeneficiaryMobile,
      BeneName: accountHolderName.trim(),
      bankName: bankName.trim(),
      IFSC: normalizedIfsc,
      SenderEmail: (senderEmail || 'noreply@example.com').trim(),
      SenderMobile: normalizedSenderMobile,
      SenderName: senderName.trim(),
      paymentType: transferMode,
      WebHook: webhookUrl || '',
      extraParam1: 'NA',
      extraParam2: 'NA',
      extraField1: clientRefId || '',
      sub_service_name: 'ExpressPay',
      remark: (remarks || `Payout transfer to ${accountHolderName}`).trim(),
    }

    console.log('[Payout] Initiating transfer:', {
      accountNumber: normalizedAccountNumber.slice(-4).padStart(normalizedAccountNumber.length, '*'),
      amount,
      bankName,
      transferMode,
      apiRequestId,
      ifsc: normalizedIfsc,
    })

    const response = await payoutClient.request<TransferResponse>({
      method: 'POST',
      endpoint: '/expressPay2',
      body: requestBody,
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
        error: apiResponse.message || 'Transfer initiation failed',
      }
    }

    const transferData = apiResponse.data

    // Map API response to our format
    return {
      success: true,
      transaction_id: transferData?.transaction_id,
      client_ref_id: transferData?.clientReqId || apiRequestId,
      status: (transferData?.status?.toLowerCase() || 'pending') as 'pending' | 'success' | 'failed' | 'processing',
      amount: transferData?.transactionAmount || amount,
      charges: transferData?.serviceCharge || charges,
      total_amount: transferData?.totalAmount || amount,
      remark: transferData?.remark,
    }
  } catch (error: any) {
    console.error('Error initiating transfer:', error)
    return {
      success: false,
      error: error.message || 'Failed to initiate transfer',
    }
  }
}

/**
 * Map API status code to status string
 * API returns: 2 = SUCCESS, 1 = PENDING, 0 = FAILED
 */
export function mapStatusCode(statusCode: number): 'pending' | 'success' | 'failed' | 'processing' {
  switch (statusCode) {
    case 2:
      return 'success'
    case 1:
      return 'pending'
    case 0:
      return 'failed'
    default:
      return 'pending'
  }
}
