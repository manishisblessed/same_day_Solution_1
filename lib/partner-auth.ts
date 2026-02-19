import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { extractClientIpFromHeaders, isIpWhitelisted } from './ip-utils'

export interface PartnerAuthResult {
  partner: {
    id: string
    name: string
    keyId: string
    permissions: string[]
  }
}

export interface PartnerAuthError {
  code: string
  message: string
  status: number
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
 * 
 * Returns partner info if authenticated, throws error if not
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

  // 1. Extract headers
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

  // 2. Validate timestamp freshness (prevent replay attacks)
  const requestTime = parseInt(timestamp, 10)
  if (isNaN(requestTime)) {
    throw {
      code: 'UNAUTHORIZED',
      message: 'Invalid x-timestamp format',
      status: 401,
    } as PartnerAuthError
  }

  const now = Date.now()
  const tolerance = 5 * 60 * 1000 // 5 minutes
  if (Math.abs(now - requestTime) > tolerance) {
    throw {
      code: 'UNAUTHORIZED',
      message: `Request timestamp expired. Must be within ${tolerance / 1000} seconds of server time.`,
      status: 401,
    } as PartnerAuthError
  }

  // 3. Look up API key and partner
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
        ip_whitelist
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

  // Get partner info (could be array or object depending on Supabase version)
  const partnerData = (keyRecord as any).partners
  const partner = Array.isArray(partnerData) ? partnerData[0] : partnerData

  if (!partner) {
    throw {
      code: 'UNAUTHORIZED',
      message: 'Partner not found for this API key',
      status: 401,
    } as PartnerAuthError
  }

  // 4. Check partner status
  if (partner.status !== 'active') {
    throw {
      code: 'UNAUTHORIZED',
      message: 'Partner account is not active',
      status: 401,
    } as PartnerAuthError
  }

  // 5. Check key expiry
  if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
    throw {
      code: 'UNAUTHORIZED',
      message: 'API key has expired',
      status: 401,
    } as PartnerAuthError
  }

  // 6. Check IP whitelist (MANDATORY — no whitelist = blocked)
  const ipWhitelist = partner.ip_whitelist || []
  if (!ipWhitelist || ipWhitelist.length === 0) {
    throw {
      code: 'UNAUTHORIZED',
      message: 'No IP whitelist configured. Contact admin to whitelist your server IP before accessing the API.',
      status: 401,
    } as PartnerAuthError
  }

  // Extract client IP from headers (supports proxy headers and CIDR notation)
  const clientIp = extractClientIpFromHeaders(request.headers)
  
  if (!clientIp) {
    console.error('[Partner Auth] Could not extract client IP', {
      partnerId: partner.id,
      headers: {
        'x-forwarded-for': request.headers.get('x-forwarded-for'),
        'x-real-ip': request.headers.get('x-real-ip'),
      },
    })
    throw {
      code: 'UNAUTHORIZED',
      message: 'Could not determine client IP address. Ensure your server is behind a proxy that sets x-forwarded-for or x-real-ip headers.',
      status: 401,
    } as PartnerAuthError
  }

  // Check IP whitelist (supports exact IPs and CIDR notation)
  if (!isIpWhitelisted(clientIp, ipWhitelist)) {
    console.warn('[Partner Auth] IP not whitelisted', {
      partnerId: partner.id,
      partnerName: partner.name,
      clientIp: clientIp,
      whitelist: ipWhitelist,
    })
    throw {
      code: 'UNAUTHORIZED',
      message: `IP address ${clientIp} is not authorized. Please contact admin to whitelist your server IP.`,
      status: 401,
    } as PartnerAuthError
  }

  // 7. Verify HMAC signature
  // For GET requests, body is empty string
  // For POST/PUT requests, we need to read the body
  let bodyStr = ''
  if (request.method === 'GET' || request.method === 'DELETE') {
    bodyStr = ''
  } else {
    try {
      // Clone request to read body without consuming it
      const clonedRequest = request.clone()
      const body = await clonedRequest.json().catch(() => null)
      bodyStr = body ? JSON.stringify(body) : ''
    } catch {
      // If body parsing fails, use empty string
      bodyStr = ''
    }
  }

  const signaturePayload = bodyStr + timestamp
  const isValid = verifyHmacSignature(
    keyRecord.api_secret,
    signaturePayload,
    signature
  )

  if (!isValid) {
    throw {
      code: 'UNAUTHORIZED',
      message: 'Invalid signature',
      status: 401,
    } as PartnerAuthError
  }

  // 8. Update last_used_at (fire-and-forget)
  Promise.resolve(
    supabase
      .from('partner_api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyRecord.id)
  ).catch((err) => {
    // Silently fail - don't block the request
    console.error('Failed to update last_used_at:', err)
  })

  return {
    partner: {
      id: partner.id,
      name: partner.name,
      keyId: keyRecord.id,
      permissions: (keyRecord.permissions as string[]) || ['read'],
    },
  }
}

