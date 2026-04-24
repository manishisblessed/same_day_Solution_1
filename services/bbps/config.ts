/**
 * BBPS API Configuration
 * SparkUpTech (default) or Chagans Technologies BBPS
 */

export type BBPSProviderId = 'sparkup' | 'chagans'

/**
 * Active BBPS upstream: sparkup (default) or chagans.
 *
 * Chagans production checklist:
 * - BBPS_PROVIDER=chagans
 * - BBPS_CHAGANS_BASE_URL (default https://chagans.com)
 * - Credentials (first match wins): CHAGHANS_BBPS_CLIENT_ID, CHAGHANS_BBPS_CONSUMER_SECRET,
 *   CHAGHANS_BBPS_AUTH_TOKEN — or BBPS_CHAGANS_CLIENT_ID / _CLIENT_SECRET / _AUTH_TOKEN
 * - Merchant: CHAGHANS_BBPS_MERCHANT_ID or BBPS_CHAGANS_MERCHANT_ID
 * - USE_BBPS_MOCK=false
 */
export function getBBPSProvider(): BBPSProviderId {
  const p = (process.env.BBPS_PROVIDER || 'sparkup').toLowerCase().trim()
  return p === 'chagans' ? 'chagans' : 'sparkup'
}

/**
 * Get BBPS API Base URL from environment
 */
export function getBBPSBaseUrl(): string {
  return process.env.BBPS_API_BASE_URL || 'https://api.sparkuptech.in/api/ba'
}

/** Chagans host (no path suffix) */
export function getChagansBaseUrl(): string {
  return (
    process.env.BBPS_CHAGANS_BASE_URL ||
    process.env.CHAGANS_API_BASE_URL ||
    'https://chagans.com'
  )
}

export function getChagansClientId(): string {
  return (
    process.env.CHAGHANS_BBPS_CLIENT_ID ||
    process.env.BBPS_CHAGANS_CLIENT_ID ||
    process.env.CHAGANS_CLIENT_ID ||
    ''
  )
}

export function getChagansClientSecret(): string {
  return (
    process.env.CHAGHANS_BBPS_CONSUMER_SECRET ||
    process.env.BBPS_CHAGANS_CLIENT_SECRET ||
    process.env.CHAGANS_CLIENT_SECRET ||
    ''
  )
}

/** Bearer token only (no "Bearer " prefix) */
export function getChagansAuthToken(): string {
  const t =
    process.env.CHAGHANS_BBPS_AUTH_TOKEN ||
    process.env.BBPS_CHAGANS_AUTH_TOKEN ||
    process.env.CHAGANS_AUTH_TOKEN ||
    ''
  return t.replace(/^Bearer\s+/i, '').trim()
}

/** Merchant id from Chagans onboarding / KYC */
export function getChagansMerchantId(): string {
  return (
    process.env.CHAGHANS_BBPS_MERCHANT_ID ||
    process.env.BBPS_CHAGANS_MERCHANT_ID ||
    process.env.CHAGANS_MERCHANT_ID ||
    ''
  )
}

export function validateChagansCredentials(): void {
  const id = getChagansClientId()
  const secret = getChagansClientSecret()
  const token = getChagansAuthToken()
  if (!id || !secret || !token) {
    throw new Error(
      'Chagans BBPS: set CHAGHANS_BBPS_CLIENT_ID, CHAGHANS_BBPS_CONSUMER_SECRET, and CHAGHANS_BBPS_AUTH_TOKEN (or BBPS_CHAGANS_* equivalents)'
    )
  }
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

