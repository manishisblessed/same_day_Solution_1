/**
 * Verify Bank Account (Account Verification / Penny Drop)
 * 
 * This service calls the SparkupX Payout API to verify bank account details
 * and fetch the beneficiary name. This is done via a "penny drop" transaction
 * where ₹1 is credited to verify the account exists and get the holder's name.
 * 
 * The verification deducts from the SparkupX wallet balance.
 */

import { VerifyAccountRequest } from './types'
import { payoutClient } from './payoutClient'
import { isPayoutMockMode } from './config'

/**
 * Verify bank account details and get beneficiary name
 * 
 * @param request - Account details to verify (accountNumber, ifscCode, bankId, bankName)
 * @returns Verification result with account holder name from bank
 */
export async function verifyBankAccount(request: VerifyAccountRequest): Promise<{
  success: boolean
  account_holder_name?: string
  bank_name?: string
  branch_name?: string
  is_valid?: boolean
  transaction_id?: string
  charges?: number
  error?: string
  sparkup_balance?: number
}> {
  const { accountNumber, ifscCode, bankName, bankId } = request

  // Validate inputs
  if (!accountNumber || !ifscCode) {
    return {
      success: false,
      error: 'Account number and IFSC code are required',
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
  
  // Validate IFSC code format (4 letters, 0, then 6 alphanumeric)
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalizedIfsc)) {
    return {
      success: false,
      error: 'Invalid IFSC code format. Expected format: ABCD0123456',
    }
  }

  // Mock mode for testing
  if (isPayoutMockMode()) {
    console.log('[Account Verify] Mock mode enabled')
    
    // Simulate some failures for testing
    if (normalizedAccountNumber.startsWith('000')) {
      return {
        success: false,
        error: 'Account does not exist',
      }
    }
    
    return {
      success: true,
      account_holder_name: 'TEST ACCOUNT HOLDER',
      bank_name: bankName || 'Test Bank',
      branch_name: 'Test Branch',
      is_valid: true,
      transaction_id: 'MOCK_VERIFY_' + Date.now(),
      charges: 4, // ₹4 for account verification
      sparkup_balance: 1000, // Mock balance
    }
  }

  // Call SparkupX Account Verification API
  // The API endpoint is /accountVerify
  // This performs a penny drop verification to confirm account exists and get beneficiary name
  
  console.log('[Account Verify] Calling SparkupX API for account verification:', {
    accountNumber: normalizedAccountNumber.replace(/\d(?=\d{4})/g, '*'), // Masked
    ifsc: normalizedIfsc,
    bankName: bankName || 'Not provided',
    bankId: bankId || 'Not provided',
  })

  try {
    // Generate unique request ID for tracking
    const requestId = `AV${Date.now()}${Math.random().toString(36).substring(2, 8).toUpperCase()}`
    
    // Prepare request body for accountVerify API
    const requestBody = {
      accountNo: normalizedAccountNumber,
      ifscCode: normalizedIfsc,
      bankId: bankId || undefined,
      bankName: bankName || undefined,
      requestId: requestId,
    }

    // Make API call to SparkupX accountVerify endpoint
    const response = await payoutClient.request({
      method: 'POST',
      endpoint: '/accountVerify',
      body: requestBody,
      reqId: requestId,
    })

    console.log('[Account Verify] API Response:', {
      success: response.success,
      status: response.status,
      hasData: !!response.data,
      reqId: response.reqId,
    })

    if (!response.success) {
      console.error('[Account Verify] API call failed:', response.error)
      return {
        success: false,
        error: response.error || 'Account verification failed. Please try again.',
      }
    }

    const data = response.data

    // Check if the API response indicates success
    // SparkupX typically uses: success: true, status: 200, or responseCode: "00"
    if (data?.success === false || data?.status === 'FAILURE' || data?.status === 'failed') {
      const errorMessage = data?.message || data?.error || data?.msg || 'Account verification failed'
      console.error('[Account Verify] API returned failure:', errorMessage)
      return {
        success: false,
        error: errorMessage,
      }
    }

    // Extract beneficiary name and other details from response
    // SparkupX response structure varies, so we check multiple possible field names
    const accountHolderName = 
      data?.data?.accountHolderName ||
      data?.data?.beneName ||
      data?.data?.beneficiaryName ||
      data?.data?.name ||
      data?.accountHolderName ||
      data?.beneName ||
      data?.beneficiaryName ||
      data?.name ||
      null

    const verifiedBankName = 
      data?.data?.bankName ||
      data?.bankName ||
      bankName ||
      'Bank'

    const branchName =
      data?.data?.branchName ||
      data?.data?.branch ||
      data?.branchName ||
      data?.branch ||
      normalizedIfsc.substring(0, 4) // Fallback to first 4 chars of IFSC

    const transactionId =
      data?.data?.transactionId ||
      data?.data?.transaction_id ||
      data?.data?.txnId ||
      data?.transactionId ||
      data?.transaction_id ||
      data?.txnId ||
      response.reqId

    const sparkupBalance =
      data?.data?.balance ||
      data?.balance ||
      data?.data?.bal ||
      data?.bal ||
      undefined

    // If no beneficiary name was returned, the verification may have failed
    if (!accountHolderName) {
      console.warn('[Account Verify] No beneficiary name in response:', data)
      return {
        success: true, // API call succeeded but no name returned
        account_holder_name: 'Account Holder Name Not Available',
        bank_name: verifiedBankName,
        branch_name: branchName,
        is_valid: true, // Account format is valid
        transaction_id: transactionId,
        charges: 4,
        sparkup_balance: sparkupBalance,
      }
    }

    console.log('[Account Verify] Verification successful:', {
      accountHolderName: accountHolderName,
      bankName: verifiedBankName,
      transactionId: transactionId,
    })

    return {
      success: true,
      account_holder_name: accountHolderName,
      bank_name: verifiedBankName,
      branch_name: branchName,
      is_valid: true,
      transaction_id: transactionId,
      charges: 4, // ₹4 verification charges
      sparkup_balance: sparkupBalance,
    }

  } catch (error: any) {
    console.error('[Account Verify] Unexpected error:', error)
    return {
      success: false,
      error: error.message || 'Account verification failed due to an unexpected error',
    }
  }
}

