/**
 * Express Pay Payout API Configuration
 * Centralized configuration for SparkUpTech Express Pay Payout API
 */

/**
 * Get Payout API Base URL
 */
export function getPayoutBaseUrl(): string {
  return process.env.PAYOUT_API_BASE_URL || 'https://api.sparkuptech.in/api/fzep/payout'
}

/**
 * Get Partner ID from environment
 * Same as BBPS credentials
 */
export function getPartnerId(): string {
  return process.env.BBPS_PARTNER_ID || process.env.BBPS_CLIENT_ID || ''
}

/**
 * Get Consumer Key from environment
 */
export function getConsumerKey(): string {
  return process.env.BBPS_CONSUMER_KEY || ''
}

/**
 * Get Consumer Secret from environment
 */
export function getConsumerSecret(): string {
  return process.env.BBPS_CONSUMER_SECRET || ''
}

/**
 * Validate Payout API credentials
 */
export function validatePayoutCredentials(): void {
  const partnerId = getPartnerId()
  const consumerKey = getConsumerKey()
  const consumerSecret = getConsumerSecret()
  
  if (!partnerId || !consumerKey || !consumerSecret) {
    throw new Error(
      'Express Pay Payout API credentials not configured. ' +
      'Please set BBPS_PARTNER_ID, BBPS_CONSUMER_KEY, and BBPS_CONSUMER_SECRET in environment variables.'
    )
  }
}

/**
 * Get API timeout in milliseconds
 */
export function getPayoutTimeout(): number {
  return parseInt(process.env.PAYOUT_API_TIMEOUT || '60000', 10) // Default 60 seconds for payouts
}

/**
 * Check if mock mode is enabled for payout
 * NOTE: Only USE_PAYOUT_MOCK controls payout mock mode (not BBPS mock)
 */
export function isPayoutMockMode(): boolean {
  // Only check USE_PAYOUT_MOCK - don't inherit from USE_BBPS_MOCK
  // This allows BBPS to be in mock mode while Payout uses real API
  return process.env.USE_PAYOUT_MOCK === 'true'
}

/**
 * Get payout charges configuration
 */
export function getPayoutCharges(): { imps: number; neft: number } {
  return {
    imps: parseFloat(process.env.PAYOUT_CHARGE_IMPS || '5'), // Default ₹5 for IMPS
    neft: parseFloat(process.env.PAYOUT_CHARGE_NEFT || '3'), // Default ₹3 for NEFT
  }
}

/**
 * Get minimum and maximum transfer limits
 */
export function getTransferLimits(): { min: number; max: number } {
  return {
    min: parseFloat(process.env.PAYOUT_MIN_AMOUNT || '100'), // Minimum ₹100
    max: parseFloat(process.env.PAYOUT_MAX_AMOUNT || '200000'), // Maximum ₹2,00,000
  }
}

