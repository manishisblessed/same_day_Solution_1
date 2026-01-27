/**
 * Express Pay Payout API Client
 * HTTP client wrapper with timeout, error handling, and logging
 */

import { 
  getPayoutBaseUrl, 
  getPartnerId, 
  getConsumerKey, 
  getConsumerSecret, 
  getPayoutTimeout, 
  validatePayoutCredentials,
  isPayoutMockMode 
} from './config'

/**
 * Payout API Request Options
 */
export interface PayoutRequestOptions {
  method: 'GET' | 'POST'
  endpoint: string
  body?: any
  reqId?: string
}

/**
 * Payout API Response
 */
export interface PayoutClientResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  status?: number
  reqId?: string
}

/**
 * Generate unique request ID
 */
function generateReqId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = 'PAY'
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * Get Payout API headers
 */
function getPayoutHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'partnerid': getPartnerId(),
    'consumerkey': getConsumerKey(),
    'consumersecret': getConsumerSecret(),
  }
}

/**
 * Log Payout API call
 */
function logPayoutApiCall(
  apiName: string,
  reqId: string,
  status?: number | string,
  responseCode?: string
): void {
  const logData: Record<string, any> = {
    api: `[Payout] ${apiName}`,
    reqId,
    timestamp: new Date().toISOString(),
  }
  
  if (status) logData.status = status
  if (responseCode) logData.responseCode = responseCode
  
  console.log('[Payout API]', JSON.stringify(logData))
}

/**
 * Log Payout API error
 */
function logPayoutApiError(
  apiName: string,
  reqId: string,
  error: Error | string
): void {
  const errorMessage = error instanceof Error ? error.message : error
  console.error('[Payout API ERROR]', JSON.stringify({
    api: `[Payout] ${apiName}`,
    reqId,
    error: errorMessage,
    timestamp: new Date().toISOString(),
  }))
}

/**
 * Payout API Client Class
 */
class PayoutClient {
  private baseUrl: string
  private timeout: number

  constructor() {
    this.baseUrl = getPayoutBaseUrl()
    this.timeout = getPayoutTimeout()
  }

  /**
   * Make API request with timeout and error handling
   */
  async request<T = any>(
    requestOptions: PayoutRequestOptions
  ): Promise<PayoutClientResponse<T>> {
    const { method, endpoint, body, reqId } = requestOptions
    const requestId = reqId || generateReqId()
    const url = `${this.baseUrl}${endpoint}`

    // Check mock mode
    if (isPayoutMockMode()) {
      logPayoutApiCall(`${method} ${endpoint}`, requestId, 'MOCK')
      return {
        success: true,
        data: this.getMockResponse(endpoint) as T,
        status: 200,
        reqId: requestId,
      }
    }

    // Validate credentials
    try {
      validatePayoutCredentials()
    } catch (error) {
      logPayoutApiError(`${method} ${endpoint}`, requestId, error as Error)
      return {
        success: false,
        error: (error as Error).message,
        reqId: requestId,
      }
    }

    // Log API call
    logPayoutApiCall(`${method} ${endpoint}`, requestId)

    try {
      // Create abort controller for timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeout)

      // Prepare request
      const headers = getPayoutHeaders()
      const fetchOptions: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      }

      if (body && method === 'POST') {
        fetchOptions.body = JSON.stringify(body)
      }

      // Make request
      const startTime = Date.now()
      const response = await fetch(url, fetchOptions)
      const responseTime = Date.now() - startTime

      clearTimeout(timeoutId)

      // Parse response
      const responseText = await response.text()
      let responseData: any
      
      try {
        responseData = JSON.parse(responseText)
      } catch {
        responseData = { raw_response: responseText }
      }

      // Log response
      logPayoutApiCall(
        `${method} ${endpoint}`,
        requestId,
        response.status,
        responseData?.status?.toString() || responseData?.responseCode
      )

      // Handle non-OK responses
      if (!response.ok) {
        const errorMessage = responseData?.message || responseData?.error || response.statusText
        logPayoutApiError(`${method} ${endpoint}`, requestId, `HTTP ${response.status}: ${errorMessage}`)
        return {
          success: false,
          error: errorMessage,
          status: response.status,
          reqId: requestId,
          data: responseData,
        }
      }

      // Return success response
      return {
        success: true,
        data: responseData,
        status: response.status,
        reqId: requestId,
      }
    } catch (error: any) {
      // Handle timeout
      if (error.name === 'AbortError') {
        const timeoutError = `Request timeout after ${this.timeout}ms`
        logPayoutApiError(`${method} ${endpoint}`, requestId, timeoutError)
        return {
          success: false,
          error: timeoutError,
          reqId: requestId,
        }
      }

      // Handle network errors
      const errorMessage = error.message || 'Network error'
      logPayoutApiError(`${method} ${endpoint}`, requestId, errorMessage)
      return {
        success: false,
        error: errorMessage,
        reqId: requestId,
      }
    }
  }

  /**
   * Get mock response for testing
   */
  private getMockResponse(endpoint: string): any {
    if (endpoint.includes('getBalance')) {
      return {
        success: true,
        message: 'Balance fetched successfully',
        data: {
          balance: 10000,
          lien: 0,
          is_active: true,
        }
      }
    }
    
    if (endpoint.includes('bankList')) {
      return {
        success: true,
        message: 'Bank list fetched successfully',
        data: [
          { id: 1, bankName: 'State Bank of India', code: 'SBI', ifsc: 'SBIN0001234', isIMPS: true, isNEFT: true, isACVerification: true, isPopular: true },
          { id: 2, bankName: 'HDFC Bank', code: 'HDFC', ifsc: 'HDFC0001234', isIMPS: true, isNEFT: true, isACVerification: true, isPopular: true },
          { id: 3, bankName: 'ICICI Bank', code: 'ICICI', ifsc: 'ICIC0001234', isIMPS: true, isNEFT: true, isACVerification: true, isPopular: true },
        ]
      }
    }

    if (endpoint.includes('verifyAccount') || endpoint.includes('accountVerify')) {
      return {
        success: true,
        message: 'Account verified successfully',
        data: {
          accountNumber: '1234567890',
          ifsc: 'SBIN0001234',
          accountHolderName: 'TEST USER',
          bankName: 'State Bank of India',
          isValid: true,
          transactionId: 'MOCK_VERIFY_' + Date.now(),
        }
      }
    }

    if (endpoint.includes('expressPay') || endpoint.includes('transfer')) {
      return {
        success: true,
        message: 'Transfer initiated successfully',
        data: {
          transactionId: 'MOCK_TXN_' + Date.now(),
          status: 'PENDING',
          amount: 1000,
          charges: 5,
        }
      }
    }

    if (endpoint.includes('status')) {
      return {
        success: true,
        message: 'Status fetched successfully',
        data: {
          transactionId: 'MOCK_TXN_123',
          status: 'SUCCESS',
          rrn: 'MOCK_RRN_' + Date.now(),
        }
      }
    }

    return { success: true, message: 'Mock response' }
  }
}

/**
 * Default Payout client instance
 */
export const payoutClient = new PayoutClient()

