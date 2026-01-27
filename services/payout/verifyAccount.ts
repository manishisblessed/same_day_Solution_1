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

  // Basic validation
  if (accountNumber.length < 9 || accountNumber.length > 18) {
    return {
      success: false,
      error: 'Invalid account number length (must be 9-18 digits)',
    }
  }

  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) {
    return {
      success: false,
      error: 'Invalid IFSC code format',
    }
  }

  // Mock mode
  if (isPayoutMockMode()) {
    // Simulate some failures for testing
    if (accountNumber.startsWith('000')) {
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
    const response = await payoutClient.request<VerifyAccountResponse>({
      method: 'POST',
      endpoint: '/accountVerify',
      body: {
        accountNumber,
        ifsc: ifscCode,
        bankName: bankName || '',
      },
    })

    if (!response.success || !response.data) {
      return {
        success: false,
        error: response.error || 'Failed to verify account',
      }
    }

    const apiResponse = response.data

    if (!apiResponse.success || !apiResponse.data) {
      return {
        success: false,
        error: apiResponse.message || apiResponse.error || 'Account verification failed',
      }
    }

    const verifyData = apiResponse.data

    return {
      success: true,
      account_holder_name: verifyData.accountHolderName,
      bank_name: verifyData.bankName,
      branch_name: verifyData.branchName,
      is_valid: verifyData.isValid !== false,
      transaction_id: verifyData.transactionId,
      charges: 2, // Typical verification charge
    }
  } catch (error: any) {
    console.error('Error verifying bank account:', error)
    return {
      success: false,
      error: error.message || 'Failed to verify account',
    }
  }
}

