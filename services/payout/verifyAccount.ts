/**
 * Verify Bank Account
 * SparkUpTech Express Pay Payout API: POST /accountVerify
 * 
 * Verifies bank account details before making a transfer
 */

import { payoutClient } from './payoutClient'
import { VerifyAccountRequest, VerifyAccountResponse } from './types'
import { isPayoutMockMode, getPayoutCharges } from './config'

/**
 * Verify bank account details
 * 
 * @param request - Account details to verify
 * @returns Verification result with account holder name
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
}> {
  const { accountNumber, ifscCode, bankName } = request

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

  // Mock mode
  if (isPayoutMockMode()) {
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
      charges: 2, // ₹2 for account verification
    }
  }

  try {
    console.log('[Account Verify] Request:', {
      accountNumber: normalizedAccountNumber.replace(/\d(?=\d{4})/g, '*'), // Mask for logging
      ifsc: normalizedIfsc,
      bankName: bankName || '',
    })

    const response = await payoutClient.request<VerifyAccountResponse>({
      method: 'POST',
      endpoint: '/accountVerify',
      body: {
        accountNumber: normalizedAccountNumber,
        ifsc: normalizedIfsc,
        bankName: bankName || '',
      },
    })

    console.log('[Account Verify] Response:', {
      success: response.success,
      status: response.status,
      hasData: !!response.data,
    })

    if (!response.success || !response.data) {
      console.error('[Account Verify] API Error:', {
        success: response.success,
        error: response.error,
        status: response.status,
        data: response.data,
      })
      return {
        success: false,
        error: response.error || 'Failed to verify account. Please check the account details and try again.',
      }
    }

    const apiResponse = response.data

    // Handle API response structure
    if (!apiResponse.success) {
      const errorMessage = apiResponse.message || apiResponse.error || 'Account verification failed'
      console.error('[Account Verify] Verification failed:', errorMessage)
      return {
        success: false,
        error: errorMessage,
      }
    }

    // Check if data exists
    if (!apiResponse.data) {
      console.error('[Account Verify] No data in response:', apiResponse)
      return {
        success: false,
        error: 'Invalid response from verification service',
      }
    }

    const verifyData = apiResponse.data

    // Validate that account is valid
    if (verifyData.isValid === false) {
      return {
        success: false,
        error: 'Account verification failed. Please check the account number and IFSC code.',
        is_valid: false,
      }
    }

    // Return success response
    return {
      success: true,
      account_holder_name: verifyData.accountHolderName || 'N/A',
      bank_name: verifyData.bankName || bankName || 'N/A',
      branch_name: verifyData.branchName || 'N/A',
      is_valid: verifyData.isValid !== false,
      transaction_id: verifyData.transactionId,
      charges: 2, // Typical verification charge
    }
  } catch (error: any) {
    console.error('[Account Verify] Exception:', error)
    return {
      success: false,
      error: error.message || 'An unexpected error occurred during account verification',
    }
  }
}

