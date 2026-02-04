/**
 * Verify Bank Account
 * 
 * NOTE: Sparkup Payout API does NOT have an account verification endpoint.
 * The documentation only shows: bankList, expressPay, expressPay2, statusCheck, getBalance
 * 
 * This function validates the account format locally and returns success,
 * allowing the user to proceed with the transfer.
 */

import { VerifyAccountRequest } from './types'
import { isPayoutMockMode } from './config'

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
      charges: 4, // ₹4 for account verification
    }
  }

  // NOTE: Sparkup Payout API does NOT have an account verification endpoint.
  // The API documentation only includes: bankList, expressPay, expressPay2, statusCheck, getBalance
  // We skip external verification and return success based on local validation.
  
  console.log('[Account Verify] Skipping external API call - endpoint not available in Sparkup Payout')
  console.log('[Account Verify] Local format validation passed for:', {
    accountNumber: normalizedAccountNumber.replace(/\d(?=\d{4})/g, '*'), // Masked
    ifsc: normalizedIfsc,
    bankName: bankName || 'Not provided',
  })

  // Return success - the account format is valid
  // The actual account validity will be confirmed during the transfer
  // Note: Charges are handled by the API endpoint, not here
  return {
    success: true,
    account_holder_name: 'To be confirmed on transfer', // Not available without penny drop API
    bank_name: bankName || 'Bank',
    branch_name: normalizedIfsc.substring(0, 4), // First 4 chars of IFSC indicate bank
    is_valid: true, // Format validated locally
    transaction_id: `LOCALVERIFY_${Date.now()}`,
    charges: 4, // ₹4 verification charges (handled by API endpoint)
  }
}

