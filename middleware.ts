import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://samedaysolution.in',
  'https://www.samedaysolution.in',
  'https://api.samedaysolution.in',
  'https://samedaysolution-api.in',
  'https://www.samedaysolution-api.in',
  // Dev only — stripped in production via CORS_DEV_ORIGINS env flag
  ...(process.env.NODE_ENV !== 'production'
    ? ['http://localhost:3000', 'http://127.0.0.1:3000']
    : []),
]

// Routes that require an authenticated Supabase session.
// If no session, the user is redirected to the corresponding login page.
const PROTECTED_PREFIXES: { prefix: string; loginPath: string }[] = [
  { prefix: '/dashboard/', loginPath: '/business-login' },
  { prefix: '/admin', loginPath: '/admin/login' },
  { prefix: '/finance-same', loginPath: '/finance-same/login' },
]

// Login pages — if the user already has a session we skip the
// server-side redirect and let the client-side AuthContext handle
// role-based routing (it knows the actual role).
const LOGIN_PAGES = ['/business-login', '/admin/login', '/finance-same/login']

function isProtectedRoute(pathname: string): { loginPath: string } | null {
  // Login pages themselves are never "protected"
  if (LOGIN_PAGES.includes(pathname)) return null
  for (const { prefix, loginPath } of PROTECTED_PREFIXES) {
    if (pathname.startsWith(prefix)) return { loginPath }
  }
  return null
}

// ── Admin gate helpers (IP allowlist + coarse mutation rate limit) ──
function getRequestIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

function getAdminIpAllowlist(): string[] {
  return (process.env.ADMIN_IP_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

const adminRlStore = new Map<string, { count: number; resetAt: number }>()
function adminMutationRateLimit(ip: string, max = 30, windowMs = 60_000): boolean {
  const now = Date.now()
  let entry = adminRlStore.get(ip)
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + windowMs }
    adminRlStore.set(ip, entry)
  }
  entry.count++
  if (adminRlStore.size > 5000) {
    for (const [k, v] of adminRlStore) if (v.resetAt < now) adminRlStore.delete(k)
  }
  return entry.count <= max
}

const apiMutationRlStore = new Map<string, { count: number; resetAt: number }>()
function apiMutationRateLimit(ip: string, max = 100, windowMs = 60_000): boolean {
  const now = Date.now()
  let entry = apiMutationRlStore.get(ip)
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + windowMs }
    apiMutationRlStore.set(ip, entry)
  }
  entry.count++
  if (apiMutationRlStore.size > 5000) {
    for (const [k, v] of apiMutationRlStore) if (v.resetAt < now) apiMutationRlStore.delete(k)
  }
  return entry.count <= max
}

// ── Security headers (applied to every page response) ──
function addSecurityHeaders(response: NextResponse): void {
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(self), payment=()'
  )

  // Content Security Policy — blocks injected scripts/styles from untrusted sources.
  // 'unsafe-inline' for style-src is required by Next.js + Tailwind CSS.
  // 'unsafe-eval' for script-src is needed by Next.js dev mode only.
  const scriptSrc = process.env.NODE_ENV === 'production'
    ? "'self' 'unsafe-inline' https://challenges.cloudflare.com"
    : "'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com"
  const csp = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src 'self' https://fonts.gstatic.com data:`,
    `img-src 'self' data: blob: https://*.supabase.co`,
    `connect-src 'self' https://*.supabase.co https://challenges.cloudflare.com https://api.samedaysolution.in wss://*.supabase.co`,
    `frame-src https://challenges.cloudflare.com`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
  ].join('; ')
  response.headers.set('Content-Security-Policy', csp)

  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload'
    )
  }
}

function addCorsHeaders(request: NextRequest, response: NextResponse): NextResponse {
  const origin = request.headers.get('origin')
  if (origin) {
    const isAllowed = ALLOWED_ORIGINS.some((allowed) => origin === allowed)
    if (isAllowed) {
      response.headers.set('Access-Control-Allow-Origin', origin)
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Geo-Location, Idempotency-Key')
      response.headers.set('Access-Control-Allow-Credentials', 'true')
      response.headers.set('Access-Control-Max-Age', '86400')
    }
  }
  return response
}

export async function middleware(request: NextRequest) {
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/')
  const isFileUploadRoute =
    request.nextUrl.pathname.includes('/upload-document') ||
    request.nextUrl.pathname.includes('/bulk-upload')

  // CORS preflight
  if (isApiRoute && request.method === 'OPTIONS') {
    const response = new NextResponse(null, { status: 204 })
    return addCorsHeaders(request, response)
  }

  // ── Admin API gate (IP allowlist + rate limit) ──
  const isAdminApi = request.nextUrl.pathname.startsWith('/api/admin/')
  if (isAdminApi) {
    const ip = getRequestIp(request)
    const allowlist = getAdminIpAllowlist()
    if (allowlist.length > 0 && !allowlist.includes(ip)) {
      console.warn(`[middleware] Blocked admin request from non-allowlisted IP ${ip} -> ${request.nextUrl.pathname}`)
      return addCorsHeaders(request, NextResponse.json({ error: 'Access denied from this network' }, { status: 403 }))
    }
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
    if (isMutation && !adminMutationRateLimit(ip)) {
      return addCorsHeaders(
        request,
        NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429, headers: { 'Retry-After': '60' } })
      )
    }
  }

  // General mutation rate limit for all non-admin API routes (100 req/min/IP)
  if (isApiRoute && !isAdminApi && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
    const ip = getRequestIp(request)
    if (!apiMutationRateLimit(ip)) {
      return addCorsHeaders(
        request,
        NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429, headers: { 'Retry-After': '60' } })
      )
    }
  }

  let response = NextResponse.next({ request: { headers: request.headers } })

  // ── API routes: return early with JSON content type + CORS + security headers ──
  // Skip Supabase session check — API routes handle their own auth
  // and getSession() can hang when refreshing expired tokens.
  if (isApiRoute) {
    if (!isFileUploadRoute) {
      response.headers.set('Content-Type', 'application/json')
    }
    response.headers.set('X-Content-Type-Options', 'nosniff')
    response.headers.set('X-Frame-Options', 'DENY')
    return addCorsHeaders(request, response)
  }

  // ── Security headers for page responses ──
  addSecurityHeaders(response)

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value)
              response.cookies.set(name, value, options)
            })
          },
        },
      }
    )

    // getUser() makes a server call and properly refreshes the session cookie.
    // getSession() only reads from storage and may return stale tokens.
    const { data: { user } } = await supabase.auth.getUser()

    // ── Route protection: redirect to login if no session ──
    const protectedMatch = isProtectedRoute(request.nextUrl.pathname)
    if (protectedMatch && !user) {
      // In development, skip server-side redirect — let client-side AuthContext handle it.
      // This avoids cookie issues with localhost (Secure flag, SameSite, etc.).
      if (process.env.NODE_ENV !== 'production') {
        return response
      }
      const url = request.nextUrl.clone()
      url.pathname = protectedMatch.loginPath
      url.searchParams.set('redirect', request.nextUrl.pathname)
      return NextResponse.redirect(url)
    }

    return response
  } catch (error: any) {
    console.error('Middleware Supabase error:', error)
    return response
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

