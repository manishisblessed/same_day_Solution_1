import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'
import { AuthUser } from '@/types/database.types'
import { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies'

/**
 * Look up user role from database tables
 */
async function getUserRole(supabase: any, email: string, userId: string): Promise<AuthUser | null> {
  console.log('[getUserRole] Looking up role for:', email)
  
  // Check which table the user belongs to
  // Use maybeSingle() instead of single() to avoid 406 errors when user doesn't belong to a table
  const [retailer, distributor, masterDistributor, admin] = await Promise.all([
    supabase.from('retailers').select('*').eq('email', email).maybeSingle(),
    supabase.from('distributors').select('*').eq('email', email).maybeSingle(),
    supabase.from('master_distributors').select('*').eq('email', email).maybeSingle(),
    supabase.from('admin_users').select('*').eq('email', email).maybeSingle(),
  ])

  if (retailer.error) console.error('[getUserRole] Retailer lookup error:', retailer.error)
  if (distributor.error) console.error('[getUserRole] Distributor lookup error:', distributor.error)
  if (masterDistributor.error) console.error('[getUserRole] MasterDistributor lookup error:', masterDistributor.error)
  if (admin.error) console.error('[getUserRole] Admin lookup error:', admin.error)

  if (retailer.data && !retailer.error) {
    console.log('[getUserRole] Found retailer:', retailer.data.name)
    return {
      id: userId,
      email: email,
      role: 'retailer',
      partner_id: retailer.data.partner_id,
      name: retailer.data.name,
    }
  }
  if (distributor.data && !distributor.error) {
    console.log('[getUserRole] Found distributor:', distributor.data.name)
    return {
      id: userId,
      email: email,
      role: 'distributor',
      partner_id: distributor.data.partner_id,
      name: distributor.data.name,
    }
  }
  if (masterDistributor.data && !masterDistributor.error) {
    console.log('[getUserRole] Found master_distributor:', masterDistributor.data.name)
    return {
      id: userId,
      email: email,
      role: 'master_distributor',
      partner_id: masterDistributor.data.partner_id,
      name: masterDistributor.data.name,
    }
  }
  if (admin.data && !admin.error) {
    console.log('[getUserRole] Found admin:', admin.data.name)
    return {
      id: userId,
      email: email,
      role: 'admin',
      name: admin.data.name,
    }
  }

  console.error('[getUserRole] User not found in any table:', email)
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
      console.error('No Supabase session cookies found. User may need to log in again.')
      console.error('Available cookies:', allCookies.map(c => c.name).join(', ') || 'none')
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
    
    if (sessionError) {
      console.error('Supabase session error:', sessionError.message)
    }
    
    if (!session) {
      console.error('No Supabase session found. User may need to log in again.')
      return null
    }

    const { data: { user }, error } = await supabase.auth.getUser()
    
    if (error) {
      console.error('Supabase auth error:', error.message)
      return null
    }
    
    if (!user) {
      console.error('No user found in Supabase session')
      return null
    }

    return await getUserRole(supabase, user.email!, user.id)
  } catch (error: any) {
    console.error('Error in getCurrentUserServer:', error?.message || error)
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
    console.error('[Token Auth] Supabase environment variables not configured')
    return null
  }

  try {
    // Create a client and set the session from the token
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    })

    // Verify the token and get user
    const { data: { user }, error } = await supabase.auth.getUser(token)
    
    if (error) {
      console.error('[Token Auth] Token verification failed:', error.message)
      return null
    }
    
    if (!user || !user.email) {
      console.error('[Token Auth] No user found from token')
      return null
    }

    console.log('[Token Auth] Successfully authenticated user:', user.email)
    return await getUserRole(supabase, user.email, user.id)
  } catch (error: any) {
    console.error('[Token Auth] Error:', error?.message || error)
    return null
  }
}

/**
 * Get current user with multiple fallback methods
 * 1. Try cookies (standard web flow)
 * 2. Try Authorization header (API/mobile flow)
 */
export async function getCurrentUserWithFallback(
  request: NextRequest
): Promise<{ user: AuthUser | null; method: 'cookies' | 'token' | 'none' }> {
  // First try Authorization header (more reliable for API routes)
  const authHeader = request.headers.get('authorization')
  if (authHeader && authHeader.startsWith('Bearer ')) {
    console.log('[Auth] Trying Authorization header first...')
    const tokenUser = await getCurrentUserFromToken(authHeader)
    if (tokenUser) {
      console.log('[Auth] Success via Authorization header:', tokenUser.email, tokenUser.role)
      return { user: tokenUser, method: 'token' }
    } else {
      console.log('[Auth] Authorization header failed')
    }
  }

  // Fallback to cookies
  console.log('[Auth] Trying cookies...')
  const cookieUser = await getCurrentUserServer()
  if (cookieUser) {
    console.log('[Auth] Success via cookies:', cookieUser.email, cookieUser.role)
    return { user: cookieUser, method: 'cookies' }
  } else {
    console.log('[Auth] Cookies failed')
  }

  console.error('[Auth] All authentication methods failed')
  console.error('[Auth] Request headers:', {
    authorization: request.headers.get('authorization') ? 'Present' : 'Missing',
    cookie: request.headers.get('cookie') ? 'Present' : 'Missing'
  })

  return { user: null, method: 'none' }
}



