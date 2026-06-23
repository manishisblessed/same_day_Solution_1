/**
 * Pay2New API Configuration
 * Credit Card Bill Payment via BBPS
 */

export function getPay2NewBaseUrl(): string {
  return process.env.PAY2NEW_BASE_URL || 'https://pay2new.in'
}

export function getPay2NewSecret(): string {
  return process.env.PAY2NEW_SECRET || ''
}

export function getPay2NewOutletId(): number {
  return parseInt(process.env.PAY2NEW_OUTLET_ID || '0', 10)
}

export function getPay2NewTimeout(): number {
  return parseInt(process.env.PAY2NEW_TIMEOUT || '90000', 10)
}

export function isPay2NewMockMode(): boolean {
  return process.env.USE_PAY2NEW_MOCK === 'true'
}

export function getPay2NewAgentMobile(): string {
  return process.env.PAY2NEW_AGENT_MOBILE || ''
}

export function getPay2NewAgentPincode(): string {
  return process.env.PAY2NEW_AGENT_PINCODE || '414002'
}

export function getPay2NewServerIp(): string {
  return process.env.PAY2NEW_SERVER_IP || '15.207.31.125'
}

export function getPay2NewDefaultLatitude(): string {
  return process.env.PAY2NEW_LATITUDE || '19.1258'
}

export function getPay2NewDefaultLongitude(): string {
  return process.env.PAY2NEW_LONGITUDE || '74.7453'
}

export function validatePay2NewCredentials(): void {
  const secret = getPay2NewSecret()
  const outletId = getPay2NewOutletId()
  if (!secret || !outletId) {
    throw new Error(
      'Pay2New credentials not configured. Set PAY2NEW_SECRET and PAY2NEW_OUTLET_ID in environment variables.'
    )
  }
}
