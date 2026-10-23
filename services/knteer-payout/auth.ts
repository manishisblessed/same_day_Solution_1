/**
 * Knteer Solution — JWT Authentication
 *
 * Knteer requires a fresh HS256 JWT per request with:
 *   { exp (seconds, ≤5 min), partnerId, refId (unique per call) }
 *
 * Built on Node's built-in crypto — no extra dependencies.
 */

import * as crypto from 'crypto'
import { getKnteerPartnerId, getKnteerPartnerSecret, validateKnteerCredentials } from './config'

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/**
 * Generate a unique refId for each API request.
 * Used in both the JWT payload and as the partnerTransId in do-transaction.
 */
export function generateRefId(): string {
  // Knteer requires exactly 10-digit numeric string
  const ts = Date.now().toString().slice(-6)
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  return `${ts}${rand}`
}

/**
 * Create a signed JWT for a single Knteer API request.
 * TTL is 4.5 minutes (270 s) — safely under the 5-minute limit.
 *
 * @param refId - Unique reference for this specific request
 */
export function createKnteerJwt(refId: string): string {
  validateKnteerCredentials()

  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64url(
    JSON.stringify({
      exp: String(Math.floor(Date.now() / 1000) + 270),
      partnerId: getKnteerPartnerId(),
      refId,
    })
  )
  const signingInput = `${header}.${payload}`
  const signature = base64url(
    crypto.createHmac('sha256', getKnteerPartnerSecret()).update(signingInput).digest()
  )
  return `${signingInput}.${signature}`
}

/**
 * Verify an inbound HS256 JWT (e.g. on the status callback) using the shared
 * Knteer partner secret. Checks signature (timing-safe), expiry, and that the
 * partnerId claim — when present — matches ours.
 */
export function verifyKnteerJwt(token: string): { valid: boolean; reason?: string } {
  try {
    const secret = getKnteerPartnerSecret()
    if (!secret) return { valid: false, reason: 'no_secret' }

    const parts = token.split('.')
    if (parts.length !== 3) return { valid: false, reason: 'malformed' }
    const [header, payload, signature] = parts

    const expected = base64url(
      crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest()
    )
    const a = Buffer.from(signature)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { valid: false, reason: 'bad_signature' }
    }

    const claims = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    )
    if (claims.exp && Math.floor(Date.now() / 1000) > Number(claims.exp)) {
      return { valid: false, reason: 'expired' }
    }
    const pid = getKnteerPartnerId()
    if (pid && claims.partnerId && String(claims.partnerId) !== String(pid)) {
      return { valid: false, reason: 'partner_mismatch' }
    }
    return { valid: true }
  } catch {
    return { valid: false, reason: 'error' }
  }
}
