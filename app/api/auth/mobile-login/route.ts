import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { rateLimit, RATE_LIMITS, getClientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Brute-force policy (mirrors /api/auth/login-guard). CAPTCHA is intentionally
// bypassed here (native apps can't render Turnstile), so this lockout is the
// primary abuse protection for the mobile login path.
const MAX_FAILED = 5
const WINDOW_MINUTES = 15

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  // Using the SERVICE ROLE key makes GoTrue skip CAPTCHA verification on the
  // password grant while still validating the user's email + password and
  // returning that user's session tokens.
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request) || new NextResponse(null, { status: 204 })
}

/**
 * POST /api/auth/mobile-login
 * Body: { email, password }
 * Returns: { access_token, refresh_token, expires_at }
 *
 * For the retailer mobile app. Authenticates with the service-role client so the
 * project-level CAPTCHA requirement is bypassed (native apps have no browser to
 * solve Turnstile). Brute-force is throttled via the login_attempts lockout.
 */
export async function POST(request: NextRequest) {
  const rl = rateLimit(request, RATE_LIMITS.login)
  if (rl.limited) return addCorsHeaders(request, rl.response!)

  const body = await request.json().catch(() => ({}))
  const email = (body?.email || '').toString().trim().toLowerCase()
  const password = (body?.password || '').toString()

  if (!email || !password) {
    return addCorsHeaders(
      request,
      NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })
    )
  }

  const admin = getAdmin()
  if (!admin) {
    return addCorsHeaders(
      request,
      NextResponse.json({ error: 'Server is not configured for sign-in.' }, { status: 500 })
    )
  }

  // Lockout check (fail-open if the RPC/table is unavailable).
  try {
    const { data, error } = await admin.rpc('recent_failed_logins', {
      p_email: email,
      p_window_minutes: WINDOW_MINUTES,
    })
    if (!error && Number(data || 0) >= MAX_FAILED) {
      return addCorsHeaders(
        request,
        NextResponse.json(
          { error: `Too many failed login attempts. Please try again in about ${WINDOW_MINUTES} minutes.` },
          { status: 429 }
        )
      )
    }
  } catch {
    // ignore — never block login on guard errors
  }

  const recordAttempt = async (success: boolean) => {
    try {
      await admin.from('login_attempts').insert({
        email,
        ip_address: getClientIp(request),
        success,
        user_agent: request.headers.get('user-agent') || 'mobile-app',
      })
    } catch {
      // best-effort
    }
  }

  const { data: authData, error: authError } = await admin.auth.signInWithPassword({
    email,
    password,
  })

  if (authError || !authData?.session) {
    await recordAttempt(false)
    const msg = authError?.message?.toLowerCase() || ''
    if (msg.includes('email not confirmed')) {
      return addCorsHeaders(
        request,
        NextResponse.json({ error: 'Your email is not verified. Please contact support.' }, { status: 401 })
      )
    }
    return addCorsHeaders(
      request,
      NextResponse.json({ error: 'Incorrect email or password. Please try again.' }, { status: 401 })
    )
  }

  await recordAttempt(true)

  return addCorsHeaders(
    request,
    NextResponse.json({
      access_token: authData.session.access_token,
      refresh_token: authData.session.refresh_token,
      expires_at: authData.session.expires_at,
      expires_in: authData.session.expires_in,
    })
  )
}
