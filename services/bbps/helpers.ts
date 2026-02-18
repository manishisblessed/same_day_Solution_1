/**
 * BBPS API Helper Functions
 * Shared utilities for BBPS API operations
 */

import { getBBPSBaseUrl, getBBPSPartnerId, getBBPSConsumerKey, getBBPSConsumerSecret, getBBPSAuthToken } from './config'

/**
 * Generate BBPS authentication headers
 * Required for all SparkUpTech BBPS API requests
 * 
 * Per Sparkup API Documentation (Feb 2026):
 * Headers must be lowercase: partnerid, consumerkey, consumersecret
 * Reference: bbps.txt lines 49-57, 6429-6434, 6792-6800
 * 
 * @param includeAuthToken - Whether to include Authorization Bearer token (optional, not required per API docs)
 */
export function getBBPSHeaders(includeAuthToken: boolean = false): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'partnerid': getBBPSPartnerId(),
    'consumerkey': getBBPSConsumerKey(), // lowercase per documentation
    'consumersecret': getBBPSConsumerSecret(), // lowercase per documentation
  }
  
  if (includeAuthToken) {
    const authToken = getBBPSAuthToken()
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`
    }
  }
  
  return headers
}

/**
 * Generate unique request ID for BBPS API
 * MUST be exactly 35 characters (alphanumeric uppercase)
 * Sparkup API validates: "Request Id must have 35 characters"
 * Example from production-tested Postman: "6B9F2O2NGQ80B68O61DNHEMP11560411430"
 */
export function generateReqId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < 35; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * Generate agent transaction ID
 * Format: BBPS-{retailerId}-{timestamp}-{random}
 */
export function generateAgentTransactionId(retailerId: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `BBPS-${retailerId}-${timestamp}-${random}`
}

/**
 * Log BBPS API call (without exposing secrets)
 */
export function logBBPSApiCall(
  apiName: string,
  reqId: string,
  billerId?: string,
  status?: number | string,
  responseCode?: string
): void {
  const logData: Record<string, any> = {
    api: apiName,
    reqId,
    timestamp: new Date().toISOString(),
  }
  
  if (billerId) logData.billerId = billerId
  if (status) logData.status = status
  if (responseCode) logData.responseCode = responseCode
  
  console.log('[BBPS API]', JSON.stringify(logData))
}

/**
 * Log BBPS API error (without exposing secrets)
 * Suppresses expected IP whitelist errors in development mode
 */
export function logBBPSApiError(
  apiName: string,
  reqId: string,
  error: Error | string,
  billerId?: string
): void {
  const errorMessage = error instanceof Error ? error.message : error
  
  // Suppress expected IP whitelist errors in development (local IP not whitelisted)
  const isExpectedIPWhitelistError = 
    process.env.NODE_ENV === 'development' &&
    (errorMessage.includes('not whitelisted') || 
     errorMessage.includes('whitelisted') ||
     errorMessage.includes('IP is not whitelisted'))
  
  if (isExpectedIPWhitelistError) {
    // Quietly log once per request instead of spamming console
    console.log(`[BBPS API] IP whitelist error (expected in local dev): ${apiName} - ${errorMessage.substring(0, 50)}...`)
    return
  }
  
  const logData: Record<string, any> = {
    api: apiName,
    reqId,
    error: errorMessage,
    timestamp: new Date().toISOString(),
  }
  
  if (billerId) logData.billerId = billerId
  
  console.error('[BBPS API ERROR]', JSON.stringify(logData))
}

/**
 * Sanitize response for logging (remove sensitive data)
 */
export function sanitizeForLogging(data: any): any {
  if (!data || typeof data !== 'object') return data
  
  const sanitized = { ...data }
  const sensitiveKeys = ['consumersecret', 'consumerSecret', 'consumer_secret', 'secret', 'password', 'token', 'key']
  
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
      sanitized[key] = '***'
    } else if (typeof sanitized[key] === 'object') {
      sanitized[key] = sanitizeForLogging(sanitized[key])
    }
  }
  
  return sanitized
}

