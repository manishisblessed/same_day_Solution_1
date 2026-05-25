/**
 * eKYC Hub API Configuration
 * Centralized configuration for connect.ekychub.in verification APIs
 */

export function getEkycUsername(): string {
  return process.env.EKYCHUB_USERNAME || ''
}

export function getEkycToken(): string {
  return process.env.EKYCHUB_TOKEN || ''
}

export function getEkycBaseUrl(): string {
  return process.env.EKYCHUB_BASE_URL || 'https://connect.ekychub.in/v3'
}

export function isEkycMockMode(): boolean {
  return process.env.EKYCHUB_USE_MOCK === 'true'
}

export function getEkycTimeout(): number {
  return parseInt(process.env.EKYCHUB_TIMEOUT || '30000', 10)
}

export function validateEkycCredentials(): void {
  const username = getEkycUsername()
  const token = getEkycToken()

  if (!username || !token) {
    throw new Error(
      'eKYC Hub credentials not configured. ' +
      'Please set EKYCHUB_USERNAME and EKYCHUB_TOKEN in environment variables.'
    )
  }
}

export function generateOrderId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
