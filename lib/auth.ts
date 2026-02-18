import { supabase } from './supabase/client'
import { AuthUser, UserRole } from '@/types/database.types'

export async function signIn(email: string, password: string, role: UserRole) {
  try {
    // First, authenticate with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError) throw authError

    // CRITICAL: Sync session to cookies so API routes can access it
    // The createBrowserClient stores in localStorage, but API routes need cookies
    // Call sync endpoint to ensure cookies are set on the server
    if (authData.session && typeof window !== 'undefined') {
      try {
        // Call sync endpoint to set cookies on server
        // This is CRITICAL for API routes to work
        const syncResponse = await fetch('/api/auth/sync-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include', // CRITICAL: Include cookies
          body: JSON.stringify({
            access_token: authData.session.access_token,
            refresh_token: authData.session.refresh_token,
          }),
        })
        
        if (!syncResponse.ok) {
          console.warn('Session sync returned non-OK status:', syncResponse.status)
        }
      } catch (syncError) {
        // This is CRITICAL - if sync fails, API routes won't work
        console.error('CRITICAL: Failed to sync session to cookies:', syncError)
        // Don't throw - let the login complete, but log the error
      }
    }

    // Then verify the user exists in the appropriate table
    let userData = null
    let tableName = ''

    switch (role) {
      case 'retailer':
        tableName = 'retailers'
        break
      case 'distributor':
        tableName = 'distributors'
        break
      case 'master_distributor':
        tableName = 'master_distributors'
        break
      case 'admin':
        tableName = 'admin_users'
        break
      case 'partner':
        tableName = 'partners'
        break
    }

    let query = supabase.from(tableName).select('*').eq('email', email)
    
    // Admin users don't have status field
    if (role !== 'admin' && role !== 'partner') {
      query = query.eq('status', 'active')
    } else if (role === 'partner') {
      query = query.eq('status', 'active')
    }
    
    const { data, error } = await query.single()

    if (error || !data) {
      await supabase.auth.signOut()
      throw new Error('User not found or inactive')
    }

    userData = data

    const user: AuthUser = {
      id: authData.user.id,
      email: authData.user.email!,
      role,
      partner_id: role === 'partner' ? userData.id : userData.partner_id,
      name: userData.name,
    }

    return { user, session: authData.session }
  } catch (error: any) {
    throw new Error(error.message || 'Authentication failed')
  }
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const { data: { user }, error } = await supabase.auth.getUser()
    
    if (error || !user) return null

    // Check which table the user belongs to
    // Use maybeSingle() instead of single() to avoid 406 errors when user doesn't belong to a table
    const [retailer, distributor, masterDistributor, admin, partner] = await Promise.all([
      supabase.from('retailers').select('*').eq('email', user.email!).maybeSingle(),
      supabase.from('distributors').select('*').eq('email', user.email!).maybeSingle(),
      supabase.from('master_distributors').select('*').eq('email', user.email!).maybeSingle(),
      supabase.from('admin_users').select('*').eq('email', user.email!).maybeSingle(),
      supabase.from('partners').select('*').eq('email', user.email!).maybeSingle(),
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
    if (partner.data && !partner.error) {
      return {
        id: user.id,
        email: user.email!,
        role: 'partner',
        partner_id: partner.data.id,
        name: partner.data.name,
      }
    }

    return null
  } catch (error) {
    return null
  }
}

