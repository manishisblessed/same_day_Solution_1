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
    // Check admin authentication
    const admin = await getCurrentUserServer()
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 401 }
      )
    }

    // Check admin permissions (super_admin or sub_admin with 'users' department)
    const { data: adminData, error: adminError } = await supabaseAdmin
      .from('admin_users')
      .select('id, admin_type, department, departments, is_active')
      .eq('email', admin.email)
      .single()

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

    // Create auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

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
      
      // Verify master distributor exists and is active
      const { data: masterDist, error: masterError } = await supabaseAdmin
        .from('master_distributors')
        .select('id, partner_id, status')
        .eq('partner_id', userData.master_distributor_id)
        .single()

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

      // Verify distributor exists and is active
      const { data: distributor, error: distError } = await supabaseAdmin
        .from('distributors')
        .select('id, partner_id, status, master_distributor_id')
        .eq('partner_id', userData.distributor_id)
        .single()

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

      // Verify master distributor exists if provided
      if (userData.master_distributor_id) {
        const { data: masterDist, error: masterError } = await supabaseAdmin
          .from('master_distributors')
          .select('id, partner_id, status')
          .eq('partner_id', userData.master_distributor_id)
          .single()

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

    // Insert into appropriate table
    const { data: tableData, error: tableError } = await supabaseAdmin
      .from(tableName)
      .insert([userData])
      .select()
      .single()

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

