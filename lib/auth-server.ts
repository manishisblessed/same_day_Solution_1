import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'
import { AuthUser } from '@/types/database.types'
import { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * Get current user from server-side (for API routes and Server Components)
 * Uses next/headers cookies() which automatically reads from the incoming request
 * Middleware refreshes the session before API routes run
 */
export async function getCurrentUserServer(
  requestCookies?: ReadonlyRequestCookies
): Promise<AuthUser | null> {
  try {
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

    // Check which table the user belongs to
    // Use maybeSingle() instead of single() to avoid 406 errors when user doesn't belong to a table
    const [retailer, distributor, masterDistributor, admin] = await Promise.all([
      supabase.from('retailers').select('*').eq('email', user.email!).maybeSingle(),
      supabase.from('distributors').select('*').eq('email', user.email!).maybeSingle(),
      supabase.from('master_distributors').select('*').eq('email', user.email!).maybeSingle(),
      supabase.from('admin_users').select('*').eq('email', user.email!).maybeSingle(),
    ])

    if (retailer.data && !retailer.error) {
      return {
        id: user.id,
        email: user.email!,
        role: 'retailer',
        partner_id: retailer.data.partner_id,
        name: retailer.data.name,
      }
    }
    if (distributor.data && !distributor.error) {
      return {
        id: user.id,
        email: user.email!,
        role: 'distributor',
        partner_id: distributor.data.partner_id,
        name: distributor.data.name,
      }
    }
    if (masterDistributor.data && !masterDistributor.error) {
      return {
        id: user.id,
        email: user.email!,
        role: 'master_distributor',
        partner_id: masterDistributor.data.partner_id,
        name: masterDistributor.data.name,
      }
    }
    if (admin.data && !admin.error) {
      return {
        id: user.id,
        email: user.email!,
        role: 'admin',
        name: admin.data.name,
      }
    }

    return null
  } catch (error: any) {
    console.error('Error in getCurrentUserServer:', error?.message || error)
    return null
  }
}


