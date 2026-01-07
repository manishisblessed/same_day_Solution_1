import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { AuthUser } from '@/types/database.types'
import { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * Get current user from server-side (for API routes)
 * Supports both direct cookie access and request-based cookie access
 */
export async function getCurrentUserServer(requestCookies?: ReadonlyRequestCookies): Promise<AuthUser | null> {
  try {
    // Use provided cookies or get from next/headers
    const cookieStore = requestCookies || await cookies()
    
    const supabase = createServerClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
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
    const [retailer, distributor, masterDistributor, admin] = await Promise.all([
      supabase.from('retailers').select('*').eq('email', user.email!).single(),
      supabase.from('distributors').select('*').eq('email', user.email!).single(),
      supabase.from('master_distributors').select('*').eq('email', user.email!).single(),
      supabase.from('admin_users').select('*').eq('email', user.email!).single(),
    ])

    if (retailer.data) {
      return {
        id: user.id,
        email: user.email!,
        role: 'retailer',
        partner_id: retailer.data.partner_id,
        name: retailer.data.name,
      }
    }
    if (distributor.data) {
      return {
        id: user.id,
        email: user.email!,
        role: 'distributor',
        partner_id: distributor.data.partner_id,
        name: distributor.data.name,
      }
    }
    if (masterDistributor.data) {
      return {
        id: user.id,
        email: user.email!,
        role: 'master_distributor',
        partner_id: masterDistributor.data.partner_id,
        name: masterDistributor.data.name,
      }
    }
    if (admin.data) {
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


