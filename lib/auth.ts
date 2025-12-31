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
    }

    let query = supabase.from(tableName).select('*').eq('email', email)
    
    // Admin users don't have status field
    if (role !== 'admin') {
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
      partner_id: userData.partner_id,
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
  } catch (error) {
    return null
  }
}

