/**
 * Rechargekit Credit Card API configuration
 * Docs: Rechargekit_CC_API_Integration_Guide_V3
 */

export function getRechargekitBaseUrl(): string {
  return process.env.RECHARGEKIT_BASE_URL || 'https://v2bapi.rechargkit.biz'
}

export function getRechargekitApiToken(): string {
  return process.env.RECHARGEKIT_API_TOKEN || ''
}

export function getRechargekitTimeout(): number {
  return parseInt(process.env.RECHARGEKIT_TIMEOUT || '90000', 10)
}

export function isRechargekitMockMode(): boolean {
  return process.env.USE_RECHARGEKIT_MOCK === 'true'
}

/** Commercial fallback when scheme charge is ₹0: ₹8 + GST */
export const RECHARGEKIT_DEFAULT_BASE_CHARGE = 8

export function validateRechargekitCredentials(): void {
  const token = getRechargekitApiToken()
  if (!token) {
    throw new Error(
      'Rechargekit credentials not configured. Set RECHARGEKIT_API_TOKEN in environment variables.'
    )
  }
}
