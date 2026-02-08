/**
 * Initiate Bank Transfer
 * SparkUpTech Express Pay Payout API: POST /expressPay2
 * 
 * Initiates IMPS/NEFT transfer to bank account
 */

import { payoutClient } from './payoutClient'
import { TransferRequest, TransferResponse, ExpressPayRequestBody, PayoutBank } from './types'
import { isPayoutMockMode, getPayoutCharges, getTransferLimits } from './config'
import { getBankList } from './bankList'

/**
 * Generate unique API Request ID (numeric, 16 digits)
 * Format: timestamp (13 digits) + random (3 digits) = 16 digits
 * This prevents "Data already exist" errors from SparkUpTech API
 */
export function generateAPIRequestId(): number {
  // Generate a 16-digit numeric ID
  // Format: timestamp (13 digits) + random (3 digits) = 16 digits
  const timestamp = Date.now() // 13 digits
  const random = Math.floor(Math.random() * 1000) // 0-999 (3 digits)
  const randomStr = random.toString().padStart(3, '0') // Ensure 3 digits
  const apiRequestIdStr = timestamp.toString() + randomStr // 16 digits total
  return parseInt(apiRequestIdStr)
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
 * Get BankID from bankList API based on IFSC code or bank name
 * This ensures we use the correct BankID from the bankList API before calling expressPay2
 * 
 * @param ifscCode - IFSC code to search for
 * @param bankName - Bank name (optional, for additional validation)
 * @param transferMode - IMPS or NEFT (to filter banks that support the mode)
 * @returns BankID and bank details, or null if not found
 */
export async function getBankIdFromBankList(
  ifscCode: string,
  bankName?: string,
  transferMode?: 'IMPS' | 'NEFT'
): Promise<{
  bankId: number
  bank: PayoutBank
} | null> {
  try {
    // Normalize IFSC code
    const normalizedIfsc = ifscCode.replace(/\s+/g, '').trim().toUpperCase()
    
    // Get bank list with appropriate filters
    const bankListOptions: {
      impsOnly?: boolean
      neftOnly?: boolean
      searchQuery?: string
    } = {}
    
    if (transferMode === 'IMPS') {
      bankListOptions.impsOnly = true
    } else if (transferMode === 'NEFT') {
      bankListOptions.neftOnly = true
    }
    
    // Search by IFSC or bank name
    if (normalizedIfsc) {
      bankListOptions.searchQuery = normalizedIfsc
    } else if (bankName) {
      bankListOptions.searchQuery = bankName
    }
    
    const bankListResult = await getBankList(bankListOptions)
    
    if (!bankListResult.success || !bankListResult.banks || bankListResult.banks.length === 0) {
      console.warn('[Payout] Bank not found in bankList:', { ifsc: normalizedIfsc, bankName })
      return null
    }
    
    // Find exact match by IFSC (most reliable)
    let matchedBank = bankListResult.banks.find(b => 
      b.ifsc && b.ifsc.toUpperCase() === normalizedIfsc
    )
    
    // If no exact IFSC match, try to match by bank name
    if (!matchedBank && bankName) {
      const normalizedBankName = bankName.trim().toUpperCase()
      matchedBank = bankListResult.banks.find(b => 
        b.bankName && b.bankName.toUpperCase().includes(normalizedBankName) ||
        normalizedBankName.includes(b.bankName.toUpperCase())
      )
    }
    
    // If still no match, use first bank from filtered results
    if (!matchedBank && bankListResult.banks.length > 0) {
      matchedBank = bankListResult.banks[0]
      console.warn('[Payout] Using first bank from filtered list (no exact match):', {
        ifsc: normalizedIfsc,
        bankName,
        matchedBankId: matchedBank.id,
        matchedBankName: matchedBank.bankName,
      })
    }
    
    if (!matchedBank) {
      return null
    }
    
    // Verify the bank supports the transfer mode
    if (transferMode === 'IMPS' && !matchedBank.isIMPS) {
      console.warn('[Payout] Bank does not support IMPS:', {
        bankId: matchedBank.id,
        bankName: matchedBank.bankName,
        ifsc: matchedBank.ifsc,
      })
      return null
    }
    
    if (transferMode === 'NEFT' && !matchedBank.isNEFT) {
      console.warn('[Payout] Bank does not support NEFT:', {
        bankId: matchedBank.id,
        bankName: matchedBank.bankName,
        ifsc: matchedBank.ifsc,
      })
      return null
    }
    
    console.log('[Payout] BankID resolved from bankList:', {
      bankId: matchedBank.id,
      bankName: matchedBank.bankName,
      ifsc: matchedBank.ifsc,
      supportsIMPS: matchedBank.isIMPS,
      supportsNEFT: matchedBank.isNEFT,
    })
    
    return {
      bankId: matchedBank.id,
      bank: matchedBank,
    }
  } catch (error: any) {
    console.error('[Payout] Error getting BankID from bankList:', error)
    return null
  }
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
  is_timeout?: boolean  // Indicates if this was a timeout - transaction may still process
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

  // Get/validate BankID from bankList API before proceeding
  // This ensures we use the correct BankID from the bankList API
  let finalBankId = bankId
  let finalBankName = bankName
  
  // If bankId is provided, we should still validate it matches the IFSC
  // If bankId is not provided, we need to get it from bankList
  if (!finalBankId || !finalBankName) {
    console.log('[Payout] BankID or bankName not provided, fetching from bankList...')
    const bankInfo = await getBankIdFromBankList(normalizedIfsc, bankName, transferMode)
    
    if (!bankInfo) {
      return {
        success: false,
        error: `Bank not found in bankList for IFSC: ${normalizedIfsc}. Please verify the IFSC code.`,
      }
    }
    
    finalBankId = bankInfo.bankId
    finalBankName = bankInfo.bank.bankName
    
    console.log('[Payout] BankID resolved from bankList:', {
      bankId: finalBankId,
      bankName: finalBankName,
      ifsc: normalizedIfsc,
    })
  } else {
    // Validate that the provided BankID matches the IFSC
    const bankInfo = await getBankIdFromBankList(normalizedIfsc, bankName, transferMode)
    
    if (bankInfo && bankInfo.bankId !== finalBankId) {
      console.warn('[Payout] Provided BankID does not match bankList:', {
        providedBankId: finalBankId,
        bankListBankId: bankInfo.bankId,
        ifsc: normalizedIfsc,
      })
      
      // Use the BankID from bankList (more reliable)
      finalBankId = bankInfo.bankId
      finalBankName = bankInfo.bank.bankName
      
      console.log('[Payout] Using BankID from bankList instead of provided value')
    }
  }
  
  if (!finalBankId || !finalBankName) {
    return {
      success: false,
      error: 'Bank ID and bank name are required. Could not resolve from bankList.',
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
    // Using BankID from bankList API (validated above)
    const requestBody: ExpressPayRequestBody = {
      AccountNo: normalizedAccountNumber,
      AmountR: amount,
      APIRequestID: apiRequestId,
      BankID: finalBankId, // Use validated BankID from bankList
      BeneMobile: normalizedBeneficiaryMobile,
      BeneName: accountHolderName.trim(),
      bankName: finalBankName.trim(), // Use validated bank name from bankList
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
      bankName: finalBankName,
      bankId: finalBankId,
      transferMode,
      apiRequestId,
      ifsc: normalizedIfsc,
      mockMode: isPayoutMockMode(),
    })

    const response = await payoutClient.request<TransferResponse>({
      method: 'POST',
      endpoint: '/expressPay2',
      body: requestBody,
    })

    // Log full API response for debugging
    console.log('[Payout] API Response:', {
      success: response.success,
      status: response.status,
      reqId: response.reqId,
      hasData: !!response.data,
      error: response.error,
      data: response.data ? JSON.stringify(response.data).substring(0, 500) : null,
    })

    if (!response.success || !response.data) {
      console.error('[Payout] Transfer failed - no success or data:', {
        success: response.success,
        error: response.error,
        status: response.status,
      })
      
      // Check if it's a SparkupX server timeout (504)
      // IMPORTANT: For timeouts, we return success=true with status='pending' and is_timeout=true
      // This prevents automatic refunds for transactions that may still be processing
      if (response.status === 504 || (response.error && (response.error.includes('504') || response.error.includes('Gateway Time') || response.error.includes('timeout')))) {
        console.warn('[Payout] Server timeout - transaction may still be processing')
        return {
          success: true,  // Return success to prevent refund - transaction may still process
          status: 'pending',
          is_timeout: true,
          remark: 'Your transaction is being processed. Please check the status in 2-3 minutes.',
          error: undefined,
        }
      }
      
      return {
        success: false,
        error: response.error || 'Failed to initiate transfer',
      }
    }

    const apiResponse = response.data

    if (!apiResponse.success) {
      console.error('[Payout] API returned failure:', {
        success: apiResponse.success,
        message: apiResponse.message,
        data: apiResponse.data,
      })
      return {
        success: false,
        error: apiResponse.message || 'Transfer initiation failed',
      }
    }

    const transferData = apiResponse.data

    console.log('[Payout] Transfer successful:', {
      transaction_id: transferData?.transaction_id,
      clientReqId: transferData?.clientReqId,
      status: transferData?.status,
      amount: transferData?.transactionAmount,
      remark: transferData?.remark,
    })

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
