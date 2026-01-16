import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentUserServer } from '@/lib/auth-server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

export const dynamic = 'force-dynamic'

/**
 * Create user (retailer, distributor, or master distributor)
 * 
 * Authorization:
 * - Super admins: Can create any user
 * - Sub-admins: Must have 'users' department permission
 */
export async function POST(request: NextRequest) {
  try {
    // Check admin authentication with timeout
    const authPromise = getCurrentUserServer()
    const authTimeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Authentication timeout')), 10000)
    )
    
    let admin
    try {
      admin = await Promise.race([authPromise, authTimeoutPromise]) as any
    } catch (authError: any) {
      console.error('[Create User API] Authentication error or timeout:', authError)
      return NextResponse.json(
        { error: 'Authentication failed or timed out. Please try again.' },
        { status: 401 }
      )
    }

    if (!admin || admin.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 401 }
      )
    }

    // Check admin permissions (super_admin or sub_admin with 'users' department)
    // Use timeout for database query
    const adminQueryPromise = supabaseAdmin
      .from('admin_users')
      .select('id, admin_type, department, departments, is_active')
      .eq('email', admin.email)
      .single()
    
    const adminQueryTimeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Database query timeout')), 15000)
    )
    
    let adminQueryResult
    try {
      adminQueryResult = await Promise.race([adminQueryPromise, adminQueryTimeoutPromise]) as any
    } catch (queryError: any) {
      console.error('[Create User API] Admin query timeout or error:', queryError)
      return NextResponse.json(
        { error: 'Database query timed out. Please try again.' },
        { status: 504 }
      )
    }
    
    const { data: adminData, error: adminError } = adminQueryResult

    if (adminError || !adminData) {
      console.error('[Create User API] Error fetching admin data:', adminError)
      return NextResponse.json(
        { error: 'User not allowed' },
        { status: 403 }
      )
    }

    // Check if admin is active
    if (adminData.is_active === false) {
      console.error('[Create User API] Admin is not active')
      return NextResponse.json(
        { error: 'User not allowed' },
        { status: 403 }
      )
    }

    // Determine admin type (handle legacy admins without admin_type)
    const adminType = adminData.admin_type || 'super_admin' // Default to super_admin for legacy admins

    // Super admins have all permissions (including legacy admins without admin_type)
    if (adminType === 'super_admin') {
      // Allow super admin to proceed - they can create any user
      console.log('[Create User API] Super admin authorized to create user')
    } else if (adminType === 'sub_admin') {
      // Check if sub-admin has 'users' department permission
      const hasUsersDepartment = 
        adminData.department === 'users' || 
        adminData.department === 'all' ||
        (adminData.departments && (
          Array.isArray(adminData.departments) && (
            adminData.departments.includes('users') || 
            adminData.departments.includes('all')
          )
        ))

      if (!hasUsersDepartment) {
        console.error('[Create User API] Sub-admin does not have users department permission', {
          department: adminData.department,
          departments: adminData.departments
        })
        return NextResponse.json(
          { error: 'User not allowed' },
          { status: 403 }
        )
      }
      console.log('[Create User API] Sub-admin with users department authorized to create user')
    } else {
      // Unknown admin type - deny access
      console.error('[Create User API] Unknown admin type:', adminType)
      return NextResponse.json(
        { error: 'User not allowed' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { email, password, role, tableName, userData } = body

    if (!email || !password || !role || !tableName) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Create auth user with timeout
    const createUserPromise = supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    
    const createUserTimeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Create user timeout')), 15000)
    )
    
    let authResult
    try {
      authResult = await Promise.race([createUserPromise, createUserTimeoutPromise]) as any
    } catch (createError: any) {
      console.error('[Create User API] Create user timeout or error:', createError)
      return NextResponse.json(
        { error: 'Failed to create user account. Please try again.' },
        { status: 504 }
      )
    }
    
    const { data: authData, error: authError } = authResult

    if (authError) {
      return NextResponse.json(
        { error: authError.message },
        { status: 400 }
      )
    }

    // Validate hierarchy requirements
    if (tableName === 'distributors') {
      if (!userData.master_distributor_id) {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: 'Master Distributor is required to create a Distributor' },
          { status: 400 }
        )
      }
      
      // Verify master distributor exists and is active (with timeout)
      const masterDistQueryPromise = supabaseAdmin
        .from('master_distributors')
        .select('id, partner_id, status')
        .eq('partner_id', userData.master_distributor_id)
        .single()
      
      const masterDistTimeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Query timeout')), 10000)
      )
      
      let masterDistResult
      try {
        masterDistResult = await Promise.race([masterDistQueryPromise, masterDistTimeoutPromise]) as any
      } catch (queryError: any) {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: 'Database query timed out. Please try again.' },
          { status: 504 }
        )
      }
      
      const { data: masterDist, error: masterError } = masterDistResult

      if (masterError || !masterDist) {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: 'Master Distributor not found' },
          { status: 400 }
        )
      }

      if (masterDist.status !== 'active') {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: 'Master Distributor must be active' },
          { status: 400 }
        )
      }
    }

    if (tableName === 'retailers') {
      if (!userData.distributor_id) {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: 'Distributor is required to create a Retailer' },
          { status: 400 }
        )
      }

      // Verify distributor exists and is active (with timeout)
      const distributorQueryPromise = supabaseAdmin
        .from('distributors')
        .select('id, partner_id, status, master_distributor_id')
        .eq('partner_id', userData.distributor_id)
        .single()
      
      const distributorTimeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Query timeout')), 10000)
      )
      
      let distributorResult
      try {
        distributorResult = await Promise.race([distributorQueryPromise, distributorTimeoutPromise]) as any
      } catch (queryError: any) {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: 'Database query timed out. Please try again.' },
          { status: 504 }
        )
      }
      
      const { data: distributor, error: distError } = distributorResult

      if (distError || !distributor) {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: 'Distributor not found' },
          { status: 400 }
        )
      }

      if (distributor.status !== 'active') {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: 'Distributor must be active' },
          { status: 400 }
        )
      }

      // Set master_distributor_id from distributor if not provided
      if (!userData.master_distributor_id && distributor.master_distributor_id) {
        userData.master_distributor_id = distributor.master_distributor_id
      }

      // Verify master distributor exists if provided (with timeout)
      if (userData.master_distributor_id) {
        const masterDistQueryPromise2 = supabaseAdmin
          .from('master_distributors')
          .select('id, partner_id, status')
          .eq('partner_id', userData.master_distributor_id)
          .single()
        
        const masterDistTimeoutPromise2 = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Query timeout')), 10000)
        )
        
        let masterDistResult2
        try {
          masterDistResult2 = await Promise.race([masterDistQueryPromise2, masterDistTimeoutPromise2]) as any
        } catch (queryError: any) {
          await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
          return NextResponse.json(
            { error: 'Database query timed out. Please try again.' },
            { status: 504 }
          )
        }
        
        const { data: masterDist, error: masterError } = masterDistResult2

        if (masterError || !masterDist) {
          await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
          return NextResponse.json(
            { error: 'Master Distributor not found' },
            { status: 400 }
          )
        }

        // Verify distributor belongs to the master distributor
        if (distributor.master_distributor_id !== userData.master_distributor_id) {
          await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
          return NextResponse.json(
            { error: 'Distributor does not belong to the selected Master Distributor' },
            { status: 400 }
          )
        }
      }
    }

    // Insert into appropriate table (with timeout)
    const insertPromise = supabaseAdmin
      .from(tableName)
      .insert([userData])
      .select()
      .single()
    
    const insertTimeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Insert timeout')), 15000)
    )
    
    let insertResult
    try {
      insertResult = await Promise.race([insertPromise, insertTimeoutPromise]) as any
    } catch (insertError: any) {
      // Rollback: delete auth user if insert fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
      console.error('[Create User API] Insert timeout or error:', insertError)
      return NextResponse.json(
        { error: 'Failed to save user data. Please try again.' },
        { status: 504 }
      )
    }
    
    const { data: tableData, error: tableError } = insertResult

    if (tableError) {
      // Rollback: delete auth user if table insert fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json(
        { error: tableError.message },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      user: tableData,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to create user' },
      { status: 500 }
    )
  }
}

