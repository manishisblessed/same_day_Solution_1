/**
 * Verify Bank Account (Account Verification / Penny Drop)
 * 
 * NOTE: As of Feb 2026, the SparkupX Payout API documentation does NOT include
 * an account verification endpoint. The available endpoints are:
 * - bankList, expressPay2, statusCheck, getBalance
 * 
 * Until SparkupX provides an account verification API, this service performs
 * LOCAL VALIDATION ONLY and returns a placeholder response.
 * 
 * CONTACT SparkupX support to get the correct account verification endpoint!
 */

import { VerifyAccountRequest } from './types'
import { isPayoutMockMode } from './config'

// Flag to track if SparkupX account verification API is available
// Set this to true once SparkupX provides the correct endpoint
const SPARKUPX_VERIFICATION_AVAILABLE = false

/**
 * Verify bank account details
 * 
 * IMPORTANT: SparkupX Payout API does NOT have an account verification endpoint
 * as per the current documentation (Feb 2026). This function only performs
 * local validation until SparkupX provides the correct API.
 * 
 * @param request - Account details to verify (accountNumber, ifscCode, bankId, bankName)
 * @returns Verification result (local validation only - no beneficiary name)
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
  verification_type?: 'local' | 'api'
  message?: string
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
    console.log('[Account Verify] Mock mode enabled - returning mock data')
    
    // Simulate some failures for testing
    if (normalizedAccountNumber.startsWith('000')) {
      return {
        success: false,
        error: 'Account does not exist',
      }
    }
    
    return {
      success: true,
      account_holder_name: 'TEST ACCOUNT HOLDER (MOCK)',
      bank_name: bankName || 'Test Bank',
      branch_name: 'Test Branch',
      is_valid: true,
      transaction_id: 'MOCK_VERIFY_' + Date.now(),
      charges: 0, // No charges for mock
      sparkup_balance: 1000,
      verification_type: 'local',
    }
  }

  // ============================================================
  // IMPORTANT: SparkupX does NOT have account verification API
  // ============================================================
  // The SparkupX Payout API documentation only includes:
  // - POST /api/fzep/payout/bankList
  // - POST /api/fzep/payout/expressPay2
  // - POST /api/fzep/payout/statusCheck
  // - GET /api/wallet/getBalance
  //
  // There is NO /accountVerify endpoint in the documentation!
  // Contact SparkupX support to get the correct endpoint.
  // ============================================================

  if (!SPARKUPX_VERIFICATION_AVAILABLE) {
    console.log('[Account Verify] SparkupX verification API NOT available')
    console.log('[Account Verify] Performing LOCAL VALIDATION ONLY')
    
    // Return success with local validation (no beneficiary name)
    // The user will need to manually confirm the beneficiary name
    return {
      success: true,
      account_holder_name: undefined, // Cannot fetch from SparkupX
      bank_name: bankName || normalizedIfsc.substring(0, 4) + ' Bank',
      branch_name: normalizedIfsc.substring(0, 4) + ' Branch',
      is_valid: true, // Account format is valid
      transaction_id: `LOCAL_${Date.now()}`,
      charges: 0, // No charges since no API call
      verification_type: 'local',
      message: 'Account format validated. Beneficiary name verification is not available - please confirm the name before transfer.',
    }
  }

  // If SparkupX verification becomes available, implement the API call here
  // For now, this code path is never reached
  return {
    success: false,
    error: 'Account verification service not configured. Please contact support.',
  }
}
