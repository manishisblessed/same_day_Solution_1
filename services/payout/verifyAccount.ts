/**
 * Verify Bank Account (Account Verification / Penny Drop)
 * 
 * Uses SparkUpTech validate_account API: POST /api/dto/validate_account
 * This endpoint validates account details and returns the beneficiary name.
 * 
 * API Documentation: https://documenter.getpostman.com/view/44095803/2sB3BGGVAw#181b2d01-1993-4826-b921-8d32d510a751
 */

import { VerifyAccountRequest, ValidateAccountRequestBody, ValidateAccountResponse } from './types'
import { isPayoutMockMode } from './config'
import { 
  getPartnerId, 
  getConsumerKey, 
  getConsumerSecret, 
  validatePayoutCredentials 
} from './config'

/**
 * Verify bank account details using SparkUpTech validate_account API
 * 
 * This function calls the /api/dto/validate_account endpoint to verify
 * account details and retrieve the beneficiary name before settlement.
 * 
 * @param request - Account details to verify (accountNumber, ifscCode, bankId, bankName)
 * @returns Verification result with beneficiary name from API
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
  reference_id?: string
  uuid?: string
}> {
  const { 
    accountNumber, 
    ifscCode, 
    bankName, 
    bankId,
    purpose_message = 'This is a penniless transaction',
    validation_type = 'penniless'
  } = request

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
      verification_type: 'api',
      reference_id: 'MOCK_REF_' + Date.now(),
      uuid: 'MOCK_UUID_' + Date.now(),
    }
  }

  // Validate credentials
  try {
    validatePayoutCredentials()
  } catch (error) {
    console.error('[Account Verify] Credentials not configured:', error)
    return {
      success: false,
      error: (error as Error).message,
    }
  }

  // Prepare API request
  const apiUrl = 'https://api.sparkuptech.in/api/dto/validate_account'
  const requestBody: ValidateAccountRequestBody = {
    purpose_message,
    validation_type,
    account_number: normalizedAccountNumber,
    ifscCode: normalizedIfsc,
  }

  // Prepare headers (lowercase as per API documentation)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'partnerid': getPartnerId(),
    'consumerkey': getConsumerKey(),
    'consumersecret': getConsumerSecret(),
  }

  try {
    console.log('[Account Verify] Calling validate_account API:', {
      account: normalizedAccountNumber.substring(0, 4) + '****' + normalizedAccountNumber.slice(-4),
      ifsc: normalizedIfsc,
    })

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    })

    const responseText = await response.text()
    let responseData: ValidateAccountResponse

    try {
      responseData = JSON.parse(responseText)
    } catch (parseError) {
      console.error('[Account Verify] Failed to parse response:', responseText)
      return {
        success: false,
        error: 'Invalid response from account verification API',
      }
    }

    // Check HTTP status
    if (!response.ok) {
      console.error('[Account Verify] API error:', {
        status: response.status,
        data: responseData,
      })
      return {
        success: false,
        error: responseData.message || `API returned status ${response.status}`,
      }
    }

    // Check API response success
    if (!responseData.success) {
      console.error('[Account Verify] API returned failure:', responseData)
      return {
        success: false,
        error: responseData.message || 'Account verification failed',
      }
    }

    // Extract beneficiary name from response
    const beneficiaryName = responseData.data?.beneficiaryName
    const accountStatus = responseData.data?.accountStatus
    const isAccountValid = accountStatus === 'valid'

    if (!isAccountValid) {
      return {
        success: false,
        error: responseData.data?.message || 'Account is not valid',
      }
    }

    console.log('[Account Verify] Account verified successfully:', {
      beneficiaryName: beneficiaryName ? beneficiaryName.substring(0, 3) + '***' : 'N/A',
      reference_id: responseData.data?.reference_id,
    })

    return {
      success: true,
      account_holder_name: beneficiaryName || undefined,
      bank_name: bankName || normalizedIfsc.substring(0, 4) + ' Bank',
      branch_name: normalizedIfsc.substring(0, 4) + ' Branch',
      is_valid: isAccountValid,
      transaction_id: responseData.data?.reference_id,
      reference_id: responseData.data?.reference_id,
      uuid: responseData.data?.uuid,
      charges: 0, // Penniless transaction - no charges
      verification_type: 'api',
      message: responseData.data?.message || 'Account verified successfully',
    }
  } catch (error: any) {
    console.error('[Account Verify] Network error:', error)
    return {
      success: false,
      error: error.message || 'Network error while verifying account',
    }
  }
}
