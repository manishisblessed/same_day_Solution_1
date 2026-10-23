/**
 * Knteer Solution Payout API — Configuration
 */

export function getKnteerBaseUrl(): string {
  return process.env.KNTEER_API_BASE_URL || 'https://api.knteersolution.com/Prod'
}

/** PT-format partnerId used in JWT payload (e.g. PT123456) */
export function getKnteerPartnerId(): string {
  return process.env.KNTEER_PARTNER_ID || ''
}

/** HS256 JWT signing secret provided by Knteer (portal: JwtToken) */
export function getKnteerPartnerSecret(): string {
  return process.env.KNTEER_JWT_TOKEN || process.env.KNTEER_PARTNER_SECRET || ''
}

export function getKnteerLatitude(): string {
  return process.env.KNTEER_LATITUDE || '28.6139'
}

export function getKnteerLongitude(): string {
  return process.env.KNTEER_LONGITUDE || '77.2090'
}

export function getKnteerTimeout(): number {
  return parseInt(process.env.KNTEER_API_TIMEOUT || '120000', 10)
}

/** Optional static shared secret for authenticating the inbound status callback. */
export function getKnteerCallbackSecret(): string {
  return process.env.KNTEER_CALLBACK_SECRET || ''
}

/**
 * Whether inbound callback authentication is enforced. Secure by default.
 * Set KNTEER_CALLBACK_ENFORCE_AUTH=false ONLY as a temporary escape hatch while
 * confirming the provider's callback signing scheme (pending transactions still
 * reconcile via the status-enquiry cron, so disabling does not lose payouts).
 */
export function isKnteerCallbackAuthEnforced(): boolean {
  return (process.env.KNTEER_CALLBACK_ENFORCE_AUTH ?? 'true') !== 'false'
}

export function isKnteerMockMode(): boolean {
  return process.env.USE_KNTEER_MOCK === 'true'
}

export function validateKnteerCredentials(): void {
  const partnerId = getKnteerPartnerId()
  const secret = getKnteerPartnerSecret()
  if (!partnerId || !secret) {
    throw new Error(
      'Knteer credentials not configured. Set KNTEER_PARTNER_ID (PT format, e.g. PT123456) and KNTEER_JWT_TOKEN.'
    )
  }
}
