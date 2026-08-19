import PaytmChecksum from 'paytmchecksum'
import * as crypto from 'crypto'

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

/**
 * Paytm ECR computes the checksum only over the TOP-LEVEL SCALAR fields of the
 * body (keys sorted case-sensitive, values joined with "|"). Object-valued fields
 * such as merchantExtendedInfo/splitInfo/displayInfo are sent in the payload but
 * are NOT part of the signed body — confirmed against Paytm's staging server:
 * signing the body without merchantExtendedInfo passes checksum validation, while
 * including it returns 0330. (Paytm's own guidance: "disregard merchantExtendedInfo".)
 */
function toChecksumParams(body: Record<string, any>): Record<string, string> {
  const params: Record<string, string> = {}
  for (const key of Object.keys(body)) {
    const value = body[key]
    if (value !== null && typeof value === 'object') continue
    params[key] = value === undefined ? '' : String(value)
  }
  return params
}

export async function generateChecksum(body: Record<string, any>): Promise<string> {
  const { merchantKey } = getPaytmConfig()
  return PaytmChecksum.generateSignature(toChecksumParams(body), merchantKey)
}

export async function verifyChecksum(body: Record<string, any>, checksum: string): Promise<boolean> {
  const { merchantKey } = getPaytmConfig()
  return PaytmChecksum.verifySignature(toChecksumParams(body), merchantKey, checksum)
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
 * Status Enquiry helper — returns the `body` of Paytm's ECR V2 status response
 * for a given merchantTransactionId. Used by the status route and to enrich the
 * lean soundbox-style S2S callback (which omits RRN, acquirementId and card data).
 */
export async function fetchPaytmStatusBody(
  merchantTransactionId: string,
  opts: { tid?: string; mid?: string; event?: string } = {}
): Promise<Record<string, any>> {
  const config = getPaytmConfig()
  const body: Record<string, any> = {
    paytmMid: opts.mid || config.mid,
    paytmTid: opts.tid || config.tid,
    transactionDateTime: formatTimestamp(),
    merchantTransactionId,
  }
  if (opts.event) body.event = opts.event
  const data = await callPaytmApi({ endpoint: '/ecr/V2/payment/status', body })
  return data?.body || {}
}

/**
 * Generate a unique alphanumeric transaction ID (8-32 chars).
 */
export function generateMerchantTxnId(prefix = 'SDS'): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `${prefix}${ts}${rand}`
}

/**
 * Guard for the Paytm POS caller-facing endpoints (sale/refund/void/status).
 * These trigger EDC terminal operations and expose card/transaction data, so
 * they must never run for anonymous callers.
 *
 * Fail-closed: requires header `x-pos-secret` to equal env `POS_API_SECRET`
 * (constant-time compare). If the secret is not configured, all requests are
 * rejected. Does NOT apply to Paytm's inbound S2S notification callback.
 */
export function isPosAuthorized(request: { headers: { get(name: string): string | null } }): boolean {
  const secret = process.env.POS_API_SECRET
  if (!secret) return false
  const provided = request.headers.get('x-pos-secret') || ''
  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}
