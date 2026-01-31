/**
 * BBPS API Configuration
 * Centralized configuration for SparkUpTech BBPS API
 */

/**
 * Get BBPS API Base URL from environment
 */
export function getBBPSBaseUrl(): string {
  return process.env.BBPS_API_BASE_URL || 'https://api.sparkuptech.in/api/ba'
}

/**
 * Get BBPS Partner ID from environment
 */
export function getBBPSPartnerId(): string {
  return process.env.BBPS_PARTNER_ID || process.env.BBPS_CLIENT_ID || ''
}

/**
 * Get BBPS Consumer Key from environment
 */
export function getBBPSConsumerKey(): string {
  return process.env.BBPS_CONSUMER_KEY || ''
}

/**
 * Get BBPS Consumer Secret from environment
 */
export function getBBPSConsumerSecret(): string {
  return process.env.BBPS_CONSUMER_SECRET || ''
}

/**
 * Get BBPS Authorization Bearer Token from environment
 * Required for payRequest endpoint
 */
export function getBBPSAuthToken(): string {
  return process.env.BBPS_AUTH_TOKEN || ''
}

/**
 * Check if mock mode is enabled
 * Uses USE_BBPS_MOCK environment variable
 * Defaults to LIVE (false) if not set
 */
export function isMockMode(): boolean {
  // Use USE_BBPS_MOCK environment variable
  // Default to LIVE (false) if not set
  return process.env.USE_BBPS_MOCK === 'true'
}

/**
 * Validate BBPS credentials are configured
 */
export function validateBBPSCredentials(): void {
  const partnerId = getBBPSPartnerId()
  const consumerKey = getBBPSConsumerKey()
  const consumerSecret = getBBPSConsumerSecret()
  
  if (!partnerId || !consumerKey || !consumerSecret) {
    throw new Error(
      'BBPS API credentials not configured. ' +
      'Please set BBPS_PARTNER_ID (or BBPS_CLIENT_ID), BBPS_CONSUMER_KEY, and BBPS_CONSUMER_SECRET in your environment variables.'
    )
  }
}

/**
 * Get API timeout in milliseconds
 * Increased to 90 seconds to accommodate Sparkup API processing time
 * BBPS payments can take up to 60-90 seconds to process through NPCI
 */
export function getAPITimeout(): number {
  return parseInt(process.env.BBPS_API_TIMEOUT || '90000', 10) // Default 90 seconds
}

