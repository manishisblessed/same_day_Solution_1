const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export function generateReqId(length = 35): string {
  let result = ''
  for (let i = 0; i < length; i++) {
    result += CHARS.charAt(Math.floor(Math.random() * CHARS.length))
  }
  return result
}

export function logBBPSApiCall(
  method: string,
  reqId: string,
  billerId?: string,
  status?: any,
  responseCode?: string
) {
  console.log(`[BBPS] ${method}`, { reqId, billerId, status, responseCode })
}

export function logBBPSApiError(
  method: string,
  reqId: string,
  error: any,
  billerId?: string
) {
  console.error(`[BBPS ERROR] ${method}`, { reqId, billerId, error: typeof error === 'string' ? error : error?.message })
}

export function extractBillerPaymentMode(modes: any): string | undefined {
  if (!modes) return undefined
  if (typeof modes === 'string') return modes
  if (Array.isArray(modes)) return modes.join(',')
  return undefined
}

export function generateAgentTransactionId(retailerId: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `BBPS-${retailerId}-${timestamp}-${random}`
}
