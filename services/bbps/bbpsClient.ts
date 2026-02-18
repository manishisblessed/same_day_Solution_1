/**
 * BBPS API Client
 * Axios/fetch wrapper with timeout, error handling, and logging
 */

import { getBBPSBaseUrl, getAPITimeout, validateBBPSCredentials, isMockMode } from './config'
import { getBBPSHeaders, logBBPSApiCall, logBBPSApiError, sanitizeForLogging } from './helpers'

/**
 * BBPS API Client Options
 */
export interface BBPSClientOptions {
  timeout?: number
  retries?: number
  retryDelay?: number
}

/**
 * BBPS API Request Options
 */
export interface BBPSRequestOptions {
  method: 'GET' | 'POST'
  endpoint: string
  body?: any
  reqId?: string
  billerId?: string
  baseUrl?: string // Optional custom base URL (for payRequest which uses different base)
  includeAuthToken?: boolean // Whether to include Authorization Bearer token
}

/**
 * BBPS API Response
 */
export interface BBPSClientResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  status?: number
  reqId?: string
}

/**
 * Default client options
 */
const DEFAULT_OPTIONS: Required<BBPSClientOptions> = {
  timeout: getAPITimeout(),
  retries: 0,
  retryDelay: 1000,
}

/**
 * BBPS API Client
 * Handles all HTTP requests to SparkUpTech BBPS API
 */
export class BBPSClient {
  private baseUrl: string
  private options: Required<BBPSClientOptions>

  constructor(options: BBPSClientOptions = {}) {
    this.baseUrl = getBBPSBaseUrl()
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Make API request with timeout and error handling
   */
  async request<T = any>(
    requestOptions: BBPSRequestOptions
  ): Promise<BBPSClientResponse<T>> {
    const { method, endpoint, body, reqId, billerId, baseUrl, includeAuthToken } = requestOptions
    const requestId = reqId || this.generateReqId()
    const url = `${baseUrl || this.baseUrl}${endpoint}`

    // Validate credentials (skip in mock mode)
    if (!isMockMode()) {
      try {
        validateBBPSCredentials()
      } catch (error) {
        logBBPSApiError('BBPSClient', requestId, error as Error, billerId)
        return {
          success: false,
          error: (error as Error).message,
          reqId: requestId,
        }
      }
    }

    // Log API call
    logBBPSApiCall(
      `${method} ${endpoint}`,
      requestId,
      billerId
    )

    try {
      // Create abort controller for timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.options.timeout)

      // Prepare request
      const headers = getBBPSHeaders(includeAuthToken || false)
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
      
      // Check if this is an expected error (IP whitelist in local dev)
      const isExpectedIPWhitelistError = 
        response.status === 401 && 
        (responseText.includes('not whitelisted') || responseText.includes('whitelisted'))
      
      // Log raw response for debugging (but suppress expected IP whitelist errors in dev)
      if ((!response.ok || responseText.includes('Invalid XML') || responseText.includes('XML')) && 
          !(isExpectedIPWhitelistError && process.env.NODE_ENV === 'development')) {
        console.error('[BBPS Client] Non-JSON or error response:', {
          status: response.status,
          statusText: response.statusText,
          responseText: responseText.substring(0, 500), // First 500 chars
          url,
        })
      } else if (isExpectedIPWhitelistError && process.env.NODE_ENV === 'development') {
        // Quietly log expected dev error (only once per request)
        console.log('[BBPS Client] IP not whitelisted (expected in local dev) - skipping verbose error log')
      }
      
      try {
        responseData = JSON.parse(responseText)
      } catch {
        // If response is not JSON, it might be an error message (e.g., "Invalid XML request")
        // Try to extract meaningful error message
        if (responseText.includes('Invalid XML') || responseText.includes('XML')) {
          responseData = {
            success: false,
            status: 'error',
            message: 'Invalid XML request',
            error: 'Invalid XML request - The API request format may be incorrect. Please check the request body.',
          }
        } else if (responseText.includes('404') || responseText.includes('Not Found')) {
          responseData = {
            success: false,
            status: 'error',
            message: 'Endpoint not found',
            error: 'API endpoint not found. Please verify the endpoint URL.',
          }
        } else if (responseText.includes('500') || responseText.includes('Internal Server Error')) {
          responseData = {
            success: false,
            status: 'error',
            message: 'Server error',
            error: 'Internal server error. Please try again later.',
          }
        } else {
          responseData = { 
            success: false,
            status: 'error',
            raw_response: responseText.substring(0, 200),
            error: responseText.substring(0, 200) || 'Unknown error from API',
          }
        }
      }

      // Log response
      logBBPSApiCall(
        `${method} ${endpoint}`,
        requestId,
        billerId,
        response.status,
        responseData?.responseCode || responseData?.status
      )

      // Handle non-OK responses or error messages in response
      // CRITICAL: Also check for Sparkup's success:false responses (HTTP 200 but API error)
      // Sparkup returns HTTP 200 with { success: false, message: "..." } for business errors
      // like "No fetch data found for given ref id." etc.
      const isHttpError = !response.ok
      const hasErrorField = !!responseData?.error
      const hasInvalidXML = responseData?.message?.includes('Invalid XML')
      const isSparkupError = responseData?.success === false  // Sparkup returns success:false for business errors
      
      if (isHttpError || hasErrorField || hasInvalidXML || isSparkupError) {
        // Extract error message from ALL possible Sparkup error structures:
        // 1. { data: { errorInfo: { error: { errorMessage: "..." } } } } (fetchBill errors)
        // 2. { data: { responseReason: "..." } } (payRequest errors)
        // 3. { message: "..." } (top-level errors)
        // 4. { error: "..." } (generic errors)
        const errorMessage = 
          responseData?.data?.errorInfo?.error?.errorMessage ||
          responseData?.data?.errorInfo?.errorMessage ||
          responseData?.data?.responseReason ||
          responseData?.data?.errorMessage ||
          responseData?.data?.error_message ||
          responseData?.message ||
          responseData?.error || 
          responseData?.responseReason ||
          response.statusText ||
          (typeof responseData === 'string' ? responseData : 'Unknown error')
        
        // Only log if not an expected IP whitelist error in dev
        const isExpectedIPWhitelistError = 
          process.env.NODE_ENV === 'development' &&
          (errorMessage.includes('not whitelisted') || 
           errorMessage.includes('whitelisted') ||
           errorMessage.includes('IP is not whitelisted'))
        
        if (!isExpectedIPWhitelistError) {
          logBBPSApiError(
            `${method} ${endpoint}`,
            requestId,
            `HTTP ${response.status}: ${errorMessage}`,
            billerId
          )
        } else {
          // Quietly log expected dev error
          console.log(`[BBPS API] IP whitelist error (expected in local dev): ${method} ${endpoint}`)
        }

        return {
          success: false,
          error: errorMessage,
          status: response.status,
          reqId: requestId,
          data: responseData, // Include full response for debugging
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
        const timeoutError = `Request timeout after ${this.options.timeout}ms`
        logBBPSApiError(`${method} ${endpoint}`, requestId, timeoutError, billerId)
        return {
          success: false,
          error: timeoutError,
          reqId: requestId,
        }
      }

      // Handle network errors
      const errorMessage = error.message || 'Network error'
      logBBPSApiError(`${method} ${endpoint}`, requestId, errorMessage, billerId)

      return {
        success: false,
        error: errorMessage,
        reqId: requestId,
      }
    }
  }

  /**
   * Generate request ID
   * MUST be exactly 35 characters for Sparkup BBPS API
   */
  private generateReqId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let result = ''
    for (let i = 0; i < 35; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }
}

/**
 * Default BBPS client instance
 */
export const bbpsClient = new BBPSClient()

