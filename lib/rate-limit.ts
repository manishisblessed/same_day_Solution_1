import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// In-memory fallback when DB is unavailable (best-effort, per-process)
interface RateLimitEntry { count: number; resetAt: number }
const memStore = new Map<string, RateLimitEntry>()
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of memStore) {
    if (entry.resetAt < now) memStore.delete(key)
  }
}, 5 * 60 * 1000)

let _adminClient: ReturnType<typeof createClient> | null = null
function getAdmin() {
  if (_adminClient) return _adminClient
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  _adminClient = createClient(url, key, { auth: { persistSession: false } })
  return _adminClient
}

export function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

export interface RateLimitOptions {
  maxRequests?: number
  windowMs?: number
  keyPrefix?: string
  identifier?: string | null
}

export const RATE_LIMITS = {
  payout: { maxRequests: 5, windowMs: 60_000, keyPrefix: 'payout' },
  transfer: { maxRequests: 5, windowMs: 60_000, keyPrefix: 'transfer' },
  bbpsPay: { maxRequests: 10, windowMs: 60_000, keyPrefix: 'bbps_pay' },
  aeps: { maxRequests: 10, windowMs: 60_000, keyPrefix: 'aeps' },
  tpin: { maxRequests: 5, windowMs: 60_000, keyPrefix: 'tpin' },
  adminWallet: { maxRequests: 20, windowMs: 60_000, keyPrefix: 'admin_wallet' },
  login: { maxRequests: 10, windowMs: 5 * 60_000, keyPrefix: 'login' },
  contact: { maxRequests: 3, windowMs: 5 * 60_000, keyPrefix: 'contact' },
} as const

/**
 * DB-backed rate limiter with in-memory fallback.
 * Uses Supabase RPC `check_rate_limit` for persistence across deploys/instances.
 * Falls back to per-process Map when DB is unavailable.
 */
export function rateLimit(
  request: NextRequest,
  { maxRequests = 10, windowMs = 60_000, keyPrefix = 'rl', identifier = null }: RateLimitOptions = {}
): { limited: boolean; response?: NextResponse } {
  const ip = getClientIp(request)
  const key = identifier
    ? `${keyPrefix}:${identifier}:${ip}`
    : `${keyPrefix}:${ip}`

  // Try DB-backed check (async, but we need sync return)
  // Schedule the DB write async and use in-memory for the immediate decision
  const admin = getAdmin()
  if (admin) {
    // Fire DB check async — enforces across instances with slight delay
    (admin.rpc as any)('check_rate_limit', {
      p_key: key,
      p_max_requests: maxRequests,
      p_window_ms: windowMs,
    }).then(({ data }: { data: any }) => {
      if (data?.limited) {
        // Mark in memory so next sync call also blocks
        const now = Date.now()
        memStore.set(key, { count: maxRequests + 1, resetAt: now + windowMs })
      }
    }).catch(() => { /* DB unavailable, rely on memory */ })
  }

  // Synchronous in-memory check (always runs, primary gate)
  const now = Date.now()
  let entry = memStore.get(key)
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + windowMs }
    memStore.set(key, entry)
  }

  entry.count++

  if (entry.count > maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    return {
      limited: true,
      response: NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      ),
    }
  }

  return { limited: false }
}
