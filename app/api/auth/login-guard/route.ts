import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { rateLimit, RATE_LIMITS, getClientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Lockout policy
const MAX_FAILED = 5 // failed attempts within the window before lockout
const WINDOW_MINUTES = 15 // sliding window

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request) || new NextResponse(null, { status: 204 })
}

/**
 * POST /api/auth/login-guard
 *
 * Brute-force protection for the login flow. Two actions:
 *  - { action: 'check', email }            -> { locked, attempts, retry_after_minutes }
 *  - { action: 'record', email, success }  -> records an attempt (for lockout + audit)
 *
 * FAIL-OPEN: if the login_attempts table/RPC is unavailable, never blocks login.
 *
 * NOTE: This protects the application login path and records an audit trail.
 * Because the Supabase anon key is public, also enable Supabase Dashboard
 * Auth protections (CAPTCHA + leaked-password protection) for full coverage.
 */
export async function POST(request: NextRequest) {
  const rl = rateLimit(request, RATE_LIMITS.login)
  if (rl.limited) return addCorsHeaders(request, rl.response!)

  try {
    const body = await request.json().catch(() => ({}))
    const action = body?.action
    const email = (body?.email || '').toString().trim().toLowerCase()

    if (!email) {
      return addCorsHeaders(request, NextResponse.json({ error: 'email is required' }, { status: 400 }))
    }

    const admin = getAdmin()
    if (!admin) {
      // Fail-open: no service client → don't block login
      return addCorsHeaders(request, NextResponse.json({ locked: false, attempts: 0 }))
    }

    if (action === 'check') {
      try {
        const { data, error } = await admin.rpc('recent_failed_logins', {
          p_email: email,
          p_window_minutes: WINDOW_MINUTES,
        })
        if (error) {
          console.warn('[login-guard] check failed (allowing):', error.message)
          return addCorsHeaders(request, NextResponse.json({ locked: false, attempts: 0 }))
        }
        const attempts = Number(data || 0)
        const locked = attempts >= MAX_FAILED
        return addCorsHeaders(
          request,
          NextResponse.json({
            locked,
            attempts,
            max_attempts: MAX_FAILED,
            retry_after_minutes: locked ? WINDOW_MINUTES : 0,
          }, { status: locked ? 429 : 200 })
        )
      } catch (e: any) {
        console.warn('[login-guard] check exception (allowing):', e?.message)
        return addCorsHeaders(request, NextResponse.json({ locked: false, attempts: 0 }))
      }
    }

    if (action === 'record') {
      const success = body?.success === true
      try {
        await admin.from('login_attempts').insert({
          email,
          ip_address: getClientIp(request),
          success,
          user_agent: request.headers.get('user-agent') || null,
        })
      } catch (e: any) {
        console.warn('[login-guard] record failed (non-fatal):', e?.message)
      }
      return addCorsHeaders(request, NextResponse.json({ ok: true }))
    }

    return addCorsHeaders(request, NextResponse.json({ error: 'invalid action' }, { status: 400 }))
  } catch (e: any) {
    // Never break login on guard errors
    return addCorsHeaders(request, NextResponse.json({ locked: false, attempts: 0 }))
  }
}
