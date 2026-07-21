import PaytmChecksum from 'paytmchecksum'

const PAYTM_URLS = {
  staging: 'https://securegw-stage.paytm.in',
  production: 'https://securegw-edc.paytm.in',
} as const

export function getPaytmConfig() {
  const env = (process.env.PAYTM_ENV || 'staging') as keyof typeof PAYTM_URLS
  return {
    mid: process.env.PAYTM_MID!,
    merchantKey: process.env.PAYTM_MERCHANT_KEY!,
    tid: process.env.PAYTM_TID!,
    channelId: process.env.PAYTM_CHANNEL_ID || 'EDC',
    callbackUrl: process.env.PAYTM_CALLBACK_URL || '',
    baseUrl: process.env.PAYTM_BASE_URL || PAYTM_URLS[env] || PAYTM_URLS.staging,
    env,
  }
}

export function formatTimestamp(date = new Date()): string {
  // Paytm expects IST (Asia/Kolkata). Generate it explicitly so the value is
  // correct regardless of the host server's timezone (EC2 runs in UTC).
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const p: Record<string, string> = {}
  for (const { type, value } of parts) p[type] = value
  const hour = p.hour === '24' ? '00' : p.hour
  return `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}:${p.second}`
}

export async function generateChecksum(body: Record<string, any>): Promise<string> {
  const { merchantKey } = getPaytmConfig()
  return PaytmChecksum.generateSignature(JSON.stringify(body), merchantKey)
}

export async function verifyChecksum(body: Record<string, any>, checksum: string): Promise<boolean> {
  const { merchantKey } = getPaytmConfig()
  return PaytmChecksum.verifySignature(JSON.stringify(body), merchantKey, checksum)
}

interface PaytmApiOptions {
  endpoint: string
  body: Record<string, any>
}

/**
 * Makes an authenticated request to Paytm POS ECR APIs.
 * Generates checksum from body, wraps in head+body envelope.
 */
export async function callPaytmApi({ endpoint, body }: PaytmApiOptions) {
  const config = getPaytmConfig()
  const now = formatTimestamp()

  const checksum = await generateChecksum(body)

  const payload = {
    head: {
      requestTimeStamp: now,
      channelId: config.channelId,
      checksum,
      version: '3.1',
    },
    body,
  }

  const url = `${config.baseUrl}${endpoint}`
  console.log(`[Paytm ECR] POST ${url}`, JSON.stringify(payload))

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  })

  const data = await res.json()
  console.log(`[Paytm ECR] Response:`, JSON.stringify(data))
  return data
}

/**
 * Generate a unique alphanumeric transaction ID (8-32 chars).
 */
export function generateMerchantTxnId(prefix = 'SDS'): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `${prefix}${ts}${rand}`
}
