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
    const { method, endpoint, body, reqId, billerId } = requestOptions
    const requestId = reqId || this.generateReqId()
    const url = `${this.baseUrl}${endpoint}`

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
      const headers = getBBPSHeaders()
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
        responseData = responseText
      }

      // Log response
      logBBPSApiCall(
        `${method} ${endpoint}`,
        requestId,
        billerId,
        response.status,
        responseData?.responseCode || responseData?.status
      )

      // Handle non-OK responses
      if (!response.ok) {
        const errorMessage = responseData?.message || responseData?.error || response.statusText
        logBBPSApiError(
          `${method} ${endpoint}`,
          requestId,
          `HTTP ${response.status}: ${errorMessage}`,
          billerId
        )

        return {
          success: false,
          error: errorMessage,
          status: response.status,
          reqId: requestId,
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
   */
  private generateReqId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let result = ''
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }
}

/**
 * Default BBPS client instance
 */
export const bbpsClient = new BBPSClient()

