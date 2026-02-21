/**
 * Alternative authentication helper for API routes
 * Uses cookies() from next/headers which should work correctly after middleware refreshes the session
 */

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'
import { AuthUser } from '@/types/database.types'

/**
 * Get current user from NextRequest (for API routes)
 * Reads cookies directly from the request object after middleware has refreshed them
 * This is the recommended approach for Next.js 14+ API routes
 */
export async function getCurrentUserFromRequest(
  request: NextRequest
): Promise<AuthUser | null> {
  try {
    // Get env vars at runtime, not module load
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Supabase environment variables not configured')
      return null
    }
    
    // Use cookies() from next/headers - this is the recommended way for API routes
    // It reads cookies from the request after middleware processes them
    const cookieStore = await cookies()
    const allCookies = cookieStore.getAll()
    
    // Debug: Log cookie names
    const supabaseCookies = allCookies.filter(c => 
      c.name.includes('supabase') || c.name.includes('sb-') || c.name.includes('auth-token')
    )
    
    if (supabaseCookies.length === 0) {
      // Cross-origin requests (e.g. Amplify → EC2) won't have Supabase cookies.
      // Callers should fall back to body-based auth (user_id + Bearer token).
      return null
    }

    // Note: Supabase SSR cookies legitimately contain JSON data, so checking for '{'
    // was incorrectly flagging valid cookies as corrupted. Removed that check.

    // Create Supabase client using cookieStore from next/headers
    // This ensures proper cookie handling in API routes
    const supabase = createServerClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
            // In API routes, we can't always set cookies in setAll
            // But we try anyway - middleware will handle the rest
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch (error) {
              // Ignore errors - middleware handles cookie refresh
            }
          },
        },
      }
    )

    // Try to get user directly - this works better with SSR cookies
    // getUser() will automatically refresh the session if needed
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    
    if (userError) {
      console.error('Supabase getUser error:', userError.message)
      console.error('User error details:', {
        message: userError.message,
        status: userError.status,
        cookiesFound: supabaseCookies.length,
        cookieNames: supabaseCookies.map(c => c.name),
      })
      
      // If getUser fails, try getSession as fallback
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !session) {
        console.error('Both getUser() and getSession() failed')
        console.error('Session error:', sessionError?.message)
        // If it's a refresh error, the session might be completely expired
        if (userError.message?.includes('refresh') || userError.message?.includes('expired') ||
            sessionError?.message?.includes('refresh') || sessionError?.message?.includes('expired')) {
          console.error('Session appears to be expired. User may need to log in again.')
        }
        return null
      }
      
      // If we got a session from fallback, use its user
      if (session?.user) {
        const fallbackUser = session.user
        // Continue with fallbackUser instead of returning null
        const [retailer, distributor, masterDistributor, admin] = await Promise.all([
          supabase.from('retailers').select('*').eq('email', fallbackUser.email!).maybeSingle(),
          supabase.from('distributors').select('*').eq('email', fallbackUser.email!).maybeSingle(),
          supabase.from('master_distributors').select('*').eq('email', fallbackUser.email!).maybeSingle(),
          supabase.from('admin_users').select('*').eq('email', fallbackUser.email!).maybeSingle(),
        ])

        if (retailer.data && !retailer.error) {
          return {
            id: fallbackUser.id,
            email: fallbackUser.email!,
            role: 'retailer',
            partner_id: retailer.data.partner_id,
            name: retailer.data.name,
          }
        }
        if (distributor.data && !distributor.error) {
          return {
            id: fallbackUser.id,
            email: fallbackUser.email!,
            role: 'distributor',
            partner_id: distributor.data.partner_id,
            name: distributor.data.name,
          }
        }
        if (masterDistributor.data && !masterDistributor.error) {
          return {
            id: fallbackUser.id,
            email: fallbackUser.email!,
            role: 'master_distributor',
            partner_id: masterDistributor.data.partner_id,
            name: masterDistributor.data.name,
          }
        }
        if (admin.data && !admin.error) {
          return {
            id: fallbackUser.id,
            email: fallbackUser.email!,
            role: 'admin',
            name: admin.data.name,
          }
        }
      }
      
      return null
    }
    
    if (!user) {
      // Log detailed debugging info
      console.error('No user found after getUser()')
      console.error('Supabase cookies found:', supabaseCookies.map(c => `${c.name}=${c.value.substring(0, 20)}...`).join(', '))
      console.error('Cookie header from request:', request.headers.get('cookie')?.substring(0, 100) || 'Missing')
      console.error('This likely means the session cookie is expired or invalid.')
      console.error('User should log out and log back in to refresh their session.')
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
    console.error('Error in getCurrentUserFromRequest:', error?.message || error)
    return null
  }
}

