/**
 * SHADVAL PAY PRIVATE LIMITED - Payout API Configuration
 * API Version: 1.0.0
 * Authentication: ShadvalKey + HMAC-256 Signature
 */

export function getShadvalKey(): string {
  return process.env.SHADVAL_PAY_KEY || ''
}

export function getShadvalBaseUrl(): string {
  const isUAT = process.env.SHADVAL_PAY_ENV !== 'production'
  return process.env.SHADVAL_PAY_BASE_URL || 'https://partners.shadvalpay.co.in/api'
}

export function getShadvalBalanceEndpoint(): string {
  const isUAT = process.env.SHADVAL_PAY_ENV !== 'production'
  return isUAT ? 'uat_wallet_balance/get_balance' : 'wallet_balance/get_balance'
}

export function getShadvalPayoutEndpoint(): string {
  const isUAT = process.env.SHADVAL_PAY_ENV !== 'production'
  return isUAT ? 'uat_payout_i/initiate_bank_transfer' : 'payout_i/initiate_bank_transfer'
}

export function getShadvalStatusEndpoint(): string {
  const isUAT = process.env.SHADVAL_PAY_ENV !== 'production'
  return isUAT ? 'uat_payout_i/check_status' : 'payout_i/check_status'
}

export function getShadvalTimeout(): number {
  return parseInt(process.env.SHADVAL_PAY_TIMEOUT || '120000', 10)
}

export function isShadvalMockMode(): boolean {
  return process.env.SHADVAL_PAY_MOCK === 'true'
}

export function validateShadvalCredentials(): void {
  const key = getShadvalKey()
  if (!key) {
    throw new Error(
      'SHADVAL PAY credentials not configured. Please set SHADVAL_PAY_KEY in environment variables.'
    )
  }
}
