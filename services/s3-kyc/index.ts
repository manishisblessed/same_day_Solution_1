/**
 * AWS S3 presigned PUT for private KYC media (selfie + liveness video).
 *
 * Implemented with AWS Signature V4 using only Node's crypto (no aws-sdk
 * dependency). Mirrors NEXTGEN's S3 selfie/video storage. When S3 is not
 * configured the wizard routes fall back to Supabase storage, so this is
 * optional for dev/mock.
 *
 * Also provides a short-lived HMAC "upload token" so the two-step
 * presign -> client-PUT -> complete handshake can be validated server-side.
 */

import crypto from 'crypto'
import { getEnv } from '@/lib/env'

export function isS3Configured(): boolean {
  return !!(
    getEnv('S3_KYC_BUCKET') &&
    getEnv('AWS_REGION') &&
    getEnv('AWS_ACCESS_KEY_ID') &&
    getEnv('AWS_SECRET_ACCESS_KEY')
  )
}

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex')
}

function hmac(key: crypto.BinaryLike | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest()
}

function amzDate(d: Date): { amzDate: string; dateStamp: string } {
  const iso = d.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { amzDate: iso, dateStamp: iso.slice(0, 8) }
}

function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  )
}

/**
 * Generate a presigned S3 URL valid for `expiresSec` seconds.
 * PUT: the client uploads the file with a plain HTTP PUT to this URL.
 * GET: short-lived read access for admin KYC review.
 */
function presignUrl(params: {
  method: 'PUT' | 'GET'
  key: string
  expiresSec?: number
  useKms?: boolean
}): string {
  const bucket = getEnv('S3_KYC_BUCKET') as string
  const region = getEnv('AWS_REGION') as string
  const accessKey = getEnv('AWS_ACCESS_KEY_ID') as string
  const secretKey = getEnv('AWS_SECRET_ACCESS_KEY') as string
  const sessionToken = getEnv('AWS_SESSION_TOKEN')
  const kmsKeyId = params.useKms ? getEnv('S3_KMS_KEY_ID') : undefined
  const expiresSec = params.expiresSec ?? 300

  const host = `${bucket}.s3.${region}.amazonaws.com`
  const canonicalUri =
    '/' + params.key.split('/').map(encodeRfc3986).join('/')

  const now = new Date()
  const { amzDate: amzDateStr, dateStamp } = amzDate(now)
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`

  const signedHeaders = 'host'
  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKey}/${credentialScope}`,
    'X-Amz-Date': amzDateStr,
    'X-Amz-Expires': String(expiresSec),
    'X-Amz-SignedHeaders': signedHeaders,
  }
  if (sessionToken) query['X-Amz-Security-Token'] = sessionToken
  if (kmsKeyId) {
    query['X-Amz-Server-Side-Encryption'] = 'aws:kms'
    query['X-Amz-Server-Side-Encryption-Aws-Kms-Key-Id'] = kmsKeyId
  }

  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(query[k])}`)
    .join('&')

  const canonicalHeaders = `host:${host}\n`
  const payloadHash = 'UNSIGNED-PAYLOAD'
  const canonicalRequest = [
    params.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDateStr,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const kDate = hmac(`AWS4${secretKey}`, dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, 's3')
  const kSigning = hmac(kService, 'aws4_request')
  const signature = crypto
    .createHmac('sha256', kSigning)
    .update(stringToSign, 'utf8')
    .digest('hex')

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

export function presignPutUrl(params: {
  key: string
  contentType: string
  expiresSec?: number
}): string {
  return presignUrl({ method: 'PUT', key: params.key, expiresSec: params.expiresSec, useKms: true })
}

/** Short-lived read URL so admins can review private KYC media. */
export function presignGetUrl(params: { key: string; expiresSec?: number }): string {
  return presignUrl({ method: 'GET', key: params.key, expiresSec: params.expiresSec ?? 600 })
}

/**
 * Build a stable object key for a KYC upload.
 */
export function buildKycKey(
  inviteId: string,
  kind: 'selfie' | 'video',
  ext: string
): string {
  const rand = crypto.randomBytes(6).toString('hex')
  return `onboarding/${inviteId}/${kind}-${Date.now()}-${rand}.${ext}`
}

// ── Upload token (HMAC) — ties a presign to its completion ──────────────────

function uploadTokenSecret(): string {
  return getEnv('NEXTAUTH_SECRET') || getEnv('JWT_SECRET') || 'kyc-upload-token-secret'
}

export function signUploadToken(payload: {
  inviteId: string
  key: string
  kind: string
  exp: number
}): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto
    .createHmac('sha256', uploadTokenSecret())
    .update(body)
    .digest('base64url')
  return `${body}.${sig}`
}

export function verifyUploadToken(
  token: string
): { inviteId: string; key: string; kind: string; exp: number } | null {
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = crypto
    .createHmac('sha256', uploadTokenSecret())
    .update(body)
    .digest('base64url')
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (typeof payload.exp === 'number' && payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}
