import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { extractClientIpFromHeaders, isIpWhitelisted } from './ip-utils'

export type PartnerApiScope = 'bbps' | 'bbps2' | 'payout' | 'settlement'

export interface PartnerAuthResult {
  partner: {
    id: string
    name: string
    keyId: string
    permissions: string[]
    bbps_enabled: boolean
    bbps2_pay2new_enabled: boolean
    settlement_enabled: boolean
    settlement2_enabled: boolean
  }
}

export interface PartnerAuthError {
  code: string
  message: string
  status: number
}

/** Parse permissions from DB (json array or string). */
export function parsePartnerKeyPermissions(raw: unknown): string[] {
  if (raw == null) return ['read']
  if (Array.isArray(raw)) return raw.map((p) => String(p).toLowerCase())
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw)
      return Array.isArray(j) ? j.map((p: unknown) => String(p).toLowerCase()) : ['read']
    } catch {
      return ['read']
    }
  }
  return ['read']
}

/** Key permission + partner-level service flag (admin POS Partner API tab). */
export function partnerCanUseApi(
  partner: PartnerAuthResult['partner'],
  scope: PartnerApiScope
): { allowed: boolean; message: string } {
  const perms = partner.permissions
  const permName = scope === 'settlement' ? 'settlement' : scope === 'payout' ? 'payout' : scope === 'bbps2' ? 'bbps2' : 'bbps'
  if (!perms.includes('all') && !perms.includes(permName)) {
    return { allowed: false, message: `Missing required permission: ${permName}` }
  }
  if (scope === 'bbps' && !partner.bbps_enabled) {
    return {
      allowed: false,
      message: 'BBPS Bill Payment is not enabled for this partner account. Contact admin.',
    }
  }
  if (scope === 'bbps2' && !partner.bbps2_pay2new_enabled) {
    return {
      allowed: false,
      message: 'BBPS-2 (Pay2New) is not enabled for this partner account. Contact admin.',
    }
  }
  if (scope === 'payout' && !partner.settlement_enabled) {
    return {
      allowed: false,
      message: 'Settlement / Payout is not enabled for this partner account. Contact admin.',
    }
  }
  if (scope === 'settlement' && !partner.settlement2_enabled) {
    return {
      allowed: false,
      message: 'Settlement-2 (SHADVAL Pay) is not enabled for this partner account. Contact admin.',
    }
  }
  return { allowed: true, message: '' }
}

/**
 * Verify HMAC-SHA256 signature with timing-safe comparison
 */
function verifyHmacSignature(
  secret: string,
  payload: string,
  providedSignature: string
): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')

  if (expectedSignature.length !== providedSignature.length) {
    return false
  }

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(providedSignature, 'hex')
    )
  } catch {
    return false
  }
}

/**
 * Partner HMAC Authentication
 *
 * Required headers:
 *   x-api-key      - Partner public API key
 *   x-signature    - HMAC-SHA256(api_secret, JSON.stringify(body) + timestamp)
 *   x-timestamp    - Unix timestamp (ms) when request was signed
 */
export async function authenticatePartner(
  request: NextRequest
): Promise<PartnerAuthResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  if (!supabaseUrl || !supabaseServiceKey) {
    throw {
      code: 'INTERNAL_ERROR',
      message: 'Server configuration error',
      status: 500,
    } as PartnerAuthError
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const apiKey = request.headers.get('x-api-key')
  const signature = request.headers.get('x-signature')
  const timestamp = request.headers.get('x-timestamp')

  if (!apiKey || !signature || !timestamp) {
    throw {
      code: 'UNAUTHORIZED',
      message: 'Missing required authentication headers: x-api-key, x-signature, x-timestamp',
      status: 401,
    } as PartnerAuthError
  }

  const requestTime = parseInt(timestamp, 10)
  if (isNaN(requestTime)) {
    throw {
      code: 'UNAUTHORIZED',
      message: 'Invalid x-timestamp format',
      status: 401,
    } as PartnerAuthError
  }

  const now = Date.now()
  const tolerance = 5 * 60 * 1000
  if (Math.abs(now - requestTime) > tolerance) {
    throw {
      code: 'UNAUTHORIZED',
      message: `Request timestamp expired. Must be within ${tolerance / 1000} seconds of server time.`,
      status: 401,
    } as PartnerAuthError
  }

  const { data: keyRecord, error: keyError } = await supabase
    .from('partner_api_keys')
    .select(`
      id,
      api_secret,
      permissions,
      expires_at,
      partner_id,
      partners (
        id,
        name,
        status,
        ip_whitelist,
        bbps_enabled,
        bbps2_pay2new_enabled,
        settlement_enabled,
        settlement2_enabled
      )
    `)
    .eq('api_key', apiKey)
    .eq('is_active', true)
    .single()

  if (keyError || !keyRecord) {
    throw {
      code: 'UNAUTHORIZED',
      message: 'Invalid API key',
      status: 401,
    } as PartnerAuthError
  }

  const partnerData = (keyRecord as any).partners
  const partner = Array.isArray(partnerData) ? partnerData[0] : partnerData

  if (!partner) {
    throw {
      code: 'UNAUTHORIZED',
      message: 'Partner not found for this API key',
      status: 401,
    } as PartnerAuthError
  }

  if (partner.status !== 'active') {
    throw {
      code: 'UNAUTHORIZED',
      message: 'Partner account is not active',
      status: 401,
    } as PartnerAuthError
  }

  if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
    throw {
      code: 'UNAUTHORIZED',
      message: 'API key has expired',
      status: 401,
    } as PartnerAuthError
  }

  const ipWhitelist = partner.ip_whitelist || []
  if (!ipWhitelist || ipWhitelist.length === 0) {
    throw {
      code: 'UNAUTHORIZED',
      message: 'No IP whitelist configured. Contact admin to whitelist your server IP before accessing the API.',
      status: 401,
    } as PartnerAuthError
  }

  const clientIp = extractClientIpFromHeaders(request.headers)

  if (!clientIp) {
    throw {
      code: 'UNAUTHORIZED',
      message: 'Could not determine client IP address. Ensure your request is routed through a proxy that sets x-forwarded-for.',
      status: 401,
    } as PartnerAuthError
  }

  if (!isIpWhitelisted(clientIp, ipWhitelist)) {
    throw {
      code: 'UNAUTHORIZED',
      message: `IP address not authorized. Your IP: ${clientIp}. Contact admin to whitelist this IP.`,
      status: 401,
    } as PartnerAuthError
  }

  let bodyStr = ''
  if (request.method === 'GET' || request.method === 'DELETE') {
    bodyStr = ''
  } else {
    try {
      const clonedRequest = request.clone()
      const body = await clonedRequest.json().catch(() => null)
      bodyStr = body ? JSON.stringify(body) : ''
    } catch {
      bodyStr = ''
    }
  }

  const signaturePayload = bodyStr + timestamp
  const isValid = verifyHmacSignature(keyRecord.api_secret, signaturePayload, signature)

  if (!isValid) {
    throw {
      code: 'UNAUTHORIZED',
      message: 'Invalid signature',
      status: 401,
    } as PartnerAuthError
  }

  Promise.resolve(
    supabase
      .from('partner_api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyRecord.id)
  ).catch((err) => {
    console.error('Failed to update last_used_at:', err)
  })

  return {
    partner: {
      id: partner.id,
      name: partner.name,
      keyId: keyRecord.id,
      permissions: parsePartnerKeyPermissions(keyRecord.permissions),
      bbps_enabled: partner.bbps_enabled === true,
      bbps2_pay2new_enabled: partner.bbps2_pay2new_enabled === true,
      settlement_enabled: partner.settlement_enabled === true,
      settlement2_enabled: partner.settlement2_enabled === true,
    },
  }
}
