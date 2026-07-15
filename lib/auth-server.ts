import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'
import { AuthUser } from '@/types/database.types'
import { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies'

/**
 * Thrown when auth fails due to a transient network issue (e.g. Supabase timeout).
 * Routes should catch this and return 503 instead of 401 to avoid triggering
 * the client-side session-expired logout flow.
 */
export class AuthNetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthNetworkError'
  }
}

function isNetworkError(err: any): boolean {
  if (!err) return false
  const msg = (err.message || err.code || '').toLowerCase()
  return msg.includes('fetch failed') ||
    msg.includes('connect timeout') ||
    msg.includes('und_err_connect_timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('network')
}

/**
 * Get a service-role Supabase client that bypasses RLS.
 * Used for role lookups so admin_users is always readable.
 */
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, {
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: 'no-store' }),
    },
  })
}

/**
 * Look up user role from database tables.
 * Uses the service-role client to bypass RLS so every table is readable.
 */
async function getUserRole(_supabase: any, email: string, userId: string): Promise<AuthUser | null> {
  const supabase = getServiceClient() || _supabase
  const [retailer, distributor, masterDistributor, admin, finance, partner] = await Promise.all([
    supabase.from('retailers').select('*').eq('email', email).eq('status', 'active').maybeSingle(),
    supabase.from('distributors').select('*').eq('email', email).eq('status', 'active').maybeSingle(),
    supabase.from('master_distributors').select('*').eq('email', email).eq('status', 'active').maybeSingle(),
    supabase.from('admin_users').select('*').eq('email', email).maybeSingle(),
    supabase.from('finance_users').select('*').eq('email', email).eq('is_active', true).maybeSingle(),
    supabase.from('partners').select('*').eq('email', email).eq('status', 'active').maybeSingle(),
  ])

  // If ALL queries returned errors, it's likely a network outage — throw so
  // the caller can return 500/503 instead of 401.
  const results = [retailer, distributor, masterDistributor, admin, finance, partner]
  const allFailed = results.every(r => r.error && !r.data)
  if (allFailed) {
    const sampleMsg = results.find(r => r.error)?.error?.message || 'All role lookups failed'
    if (isNetworkError({ message: sampleMsg })) {
      throw new AuthNetworkError(sampleMsg)
    }
  }

  // Check admin_users FIRST — admin is the highest privilege level and must
  // take precedence when the same email exists in multiple tables.
  if (admin.data && !admin.error) {
    return {
      id: userId,
      email: email,
      role: 'admin',
      name: admin.data.name,
    }
  }
  if (finance.data && !finance.error && finance.data.is_active !== false) {
    return {
      id: userId,
      email: email,
      role: 'finance_executive',
      name: finance.data.name,
      phone: finance.data.phone ?? undefined,
    }
  }
  if (masterDistributor.data && !masterDistributor.error) {
    return {
      id: userId,
      email: email,
      role: 'master_distributor',
      partner_id: masterDistributor.data.partner_id,
      name: masterDistributor.data.name,
    }
  }
  if (distributor.data && !distributor.error) {
    return {
      id: userId,
      email: email,
      role: 'distributor',
      partner_id: distributor.data.partner_id,
      name: distributor.data.name,
    }
  }
  if (retailer.data && !retailer.error) {
    return {
      id: userId,
      email: email,
      role: 'retailer',
      partner_id: retailer.data.partner_id,
      name: retailer.data.name,
    }
  }
  if (partner.data && !partner.error) {
    return {
      id: userId,
      email: email,
      role: 'partner',
      partner_id: partner.data.id,
      name: partner.data.name,
    }
  }

  return null
}

/**
 * Get current user from server-side (for API routes and Server Components)
 * Uses next/headers cookies() which automatically reads from the incoming request
 * Middleware refreshes the session before API routes run
 */
export async function getCurrentUserServer(
  requestCookies?: ReadonlyRequestCookies
): Promise<AuthUser | null> {
  try {
    // Get env vars at runtime, not module load
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Supabase environment variables not configured')
      return null
    }
    
    // Use provided cookies or get from next/headers
    // In API routes, await cookies() automatically reads from the incoming request
    // Middleware refreshes the session before API routes execute
    const cookieStore = requestCookies || await cookies()
    
    // Debug: Log cookie names to help diagnose issues
    const allCookies = cookieStore.getAll()
    const supabaseCookieNames = allCookies
      .map(c => c.name)
      .filter(name => name.includes('supabase') || name.includes('sb-'))
    
    if (supabaseCookieNames.length === 0) {
      return null
    }
    
    const supabase = createServerClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // The `setAll` method was called from a Server Component.
              // This can be ignored if you have middleware refreshing
              // user sessions.
            }
          },
        },
      }
    )

    // Try to get session first, then user
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    
    if (sessionError || !session) {
      if (sessionError && isNetworkError(sessionError)) {
        throw new AuthNetworkError(sessionError.message)
      }
      return null
    }

    const { data: { user }, error } = await supabase.auth.getUser()
    
    if (error || !user) {
      if (error && isNetworkError(error)) {
        throw new AuthNetworkError(error.message)
      }
      return null
    }

    return await getUserRole(supabase, user.email!, user.id)
  } catch (err: any) {
    if (err instanceof AuthNetworkError) throw err
    if (isNetworkError(err)) throw new AuthNetworkError(err.message)
    return null
  }
}

/**
 * Get current user from Authorization header (Bearer token)
 * Fallback when cookies aren't available (e.g., cross-origin requests, mobile apps)
 */
export async function getCurrentUserFromToken(
  authHeader: string | null
): Promise<AuthUser | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.replace('Bearer ', '')
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  
  if (!supabaseUrl || !supabaseAnonKey) {
    return null
  }

  try {
    // Create a client and set the session from the token
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        },
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, cache: 'no-store' }),
      }
    })

    // Verify the token and get user
    const { data: { user }, error } = await supabase.auth.getUser(token)
    
    if (error || !user || !user.email) {
      if (error && isNetworkError(error)) {
        throw new AuthNetworkError(error.message)
      }
      console.error('[Auth] Token verification failed:', error?.message || 'No user/email')
      return null
    }

    const roleUser = await getUserRole(supabase, user.email, user.id)
    if (!roleUser) {
      console.error('[Auth] getUserRole returned null for:', user.email)
    }
    return roleUser
  } catch (err: any) {
    if (err instanceof AuthNetworkError) throw err
    if (isNetworkError(err)) {
      throw new AuthNetworkError(err.message)
    }
    console.error('[Auth] getCurrentUserFromToken exception:', err?.message)
    return null
  }
}

/**
 * Verify the user has an active entry in user_sessions.
 * Returns the user if valid, null if kicked/expired.
 * On check failure, logs a warning and returns the user (fail-open to avoid lockout).
 */
async function checkActiveSession(user: AuthUser): Promise<AuthUser | null> {
  try {
    const svc = getServiceClient()
    if (!svc) return user

    const { data: activeSession } = await svc
      .from('user_sessions')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .limit(1)
      .maybeSingle()

    if (!activeSession) {
      return null
    }
  } catch {
    console.warn('[auth-server] user_sessions check failed, allowing request')
  }
  return user
}

/**
 * Get current user with multiple fallback methods
 * 1. Try cookies (standard web flow)
 * 2. Try Authorization header (API/mobile flow)
 *
 * Throws AuthNetworkError when auth fails due to network issues so routes
 * can respond with 503 instead of 401 (avoiding false session-expired logouts).
 */
export async function getCurrentUserWithFallback(
  request: NextRequest,
  opts?: { skipSessionCheck?: boolean }
): Promise<{ user: AuthUser | null; method: 'cookies' | 'token' | 'none' }> {
  let networkError: AuthNetworkError | null = null
  // register-session bootstraps the very first user_sessions row, so it must
  // authenticate WITHOUT requiring a pre-existing active session (chicken-and-egg).
  const skipSessionCheck = opts?.skipSessionCheck === true

  // First try Authorization header (more reliable for API routes)
  const authHeader = request.headers.get('authorization')
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const tokenUser = await getCurrentUserFromToken(authHeader)
      if (tokenUser) {
        if (skipSessionCheck) return { user: tokenUser, method: 'token' }
        const checkedUser = await checkActiveSession(tokenUser)
        if (!checkedUser) return { user: null, method: 'none' }
        return { user: checkedUser, method: 'token' }
      }
      console.warn('[Auth] Bearer token present but auth failed, falling back to cookies')
    } catch (err: any) {
      if (err instanceof AuthNetworkError) {
        networkError = err
        console.warn('[Auth] Token auth hit network error, falling back to cookies')
      } else {
        throw err
      }
    }
  } else {
    console.warn('[Auth] No Authorization header, trying cookies')
  }

  try {
    const cookieUser = await getCurrentUserServer()
    if (cookieUser) {
      if (skipSessionCheck) return { user: cookieUser, method: 'cookies' }
      const checkedUser = await checkActiveSession(cookieUser)
      if (!checkedUser) return { user: null, method: 'none' }
      return { user: checkedUser, method: 'cookies' }
    }
    console.warn('[Auth] Cookie auth also failed')
  } catch (err: any) {
    if (isNetworkError(err)) {
      networkError = new AuthNetworkError(err.message)
    } else {
      console.error('[Auth] Cookie auth threw:', err?.message)
    }
  }

  // If both methods failed due to network issues, throw so the route
  // returns 503 rather than 401 (which would trigger client logout).
  if (networkError) {
    throw networkError
  }

  return { user: null, method: 'none' }
}



