import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const dynamic = 'force-dynamic'

// Get all sub-admins
export async function GET(request: NextRequest) {
  try {
    const admin = await getCurrentUserServer()
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 401 }
      )
    }

    // Verify admin is super_admin
    const { data: adminData } = await supabase
      .from('admin_users')
      .select('admin_type')
      .eq('email', admin.email)
      .single()

    if (adminData?.admin_type !== 'super_admin') {
      return NextResponse.json(
        { error: 'Only super admins can manage sub-admins' },
        { status: 403 }
      )
    }

    // Get all admins (including sub-admins)
    const { data: admins, error } = await supabase
      .from('admin_users')
      .select(`
        id,
        email,
        name,
        admin_type,
        department,
        departments,
        permissions,
        is_active,
        created_at,
        created_by,
        creator:admin_users!created_by(name, email)
      `)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching sub-admins:', error)
      return NextResponse.json(
        { error: 'Failed to fetch sub-admins' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      admins: admins || []
    })
  } catch (error: any) {
    console.error('Error in GET sub-admins:', error)
    return NextResponse.json(
      { error: 'Failed to fetch sub-admins' },
      { status: 500 }
    )
  }
}

// Create sub-admin
export async function POST(request: NextRequest) {
  try {
    const admin = await getCurrentUserServer()
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 401 }
      )
    }

    // Verify admin is super_admin
    const { data: adminData } = await supabase
      .from('admin_users')
      .select('id, admin_type')
      .eq('email', admin.email)
      .single()

    if (adminData?.admin_type !== 'super_admin') {
      return NextResponse.json(
        { error: 'Only super admins can create sub-admins' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { email, name, password, departments, permissions, is_active = true } = body

    // Validation
    if (!email || !name || !password) {
      return NextResponse.json(
        { error: 'email, name, and password are required' },
        { status: 400 }
      )
    }

    // Validate departments array
    const validDepartments = ['wallet', 'commission', 'mdr', 'limits', 'services', 'reversals', 'disputes', 'reports', 'users', 'settings', 'all']
    if (!departments || !Array.isArray(departments) || departments.length === 0) {
      return NextResponse.json(
        { error: 'At least one department must be selected' },
        { status: 400 }
      )
    }

    // Validate each department
    for (const dept of departments) {
      if (!validDepartments.includes(dept)) {
        return NextResponse.json(
          { error: `Invalid department: ${dept}` },
          { status: 400 }
        )
      }
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      )
    }

    // Check if email already exists
    const { data: existingAdmin } = await supabase
      .from('admin_users')
      .select('id')
      .eq('email', email)
      .single()

    if (existingAdmin) {
      return NextResponse.json(
        { error: 'Admin with this email already exists' },
        { status: 400 }
      )
    }

    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (authError) {
      console.error('Error creating auth user:', authError)
      return NextResponse.json(
        { error: authError.message || 'Failed to create admin user' },
        { status: 500 }
      )
    }

    // Create admin user record
    // Also set single department field for backward compatibility (use first department or 'all')
    const singleDepartment = departments.includes('all') ? 'all' : departments[0]
    
    const { data: newAdmin, error: adminError } = await supabase
      .from('admin_users')
      .insert({
        id: authData.user.id,
        email,
        name,
        admin_type: 'sub_admin',
        department: singleDepartment, // For backward compatibility
        departments: departments, // New array field
        permissions: permissions || {},
        is_active,
        created_by: adminData.id
      })
      .select()
      .single()

    if (adminError) {
      // Rollback: delete auth user if admin creation fails
      await supabase.auth.admin.deleteUser(authData.user.id)
      console.error('Error creating admin record:', adminError)
      return NextResponse.json(
        { error: 'Failed to create admin record' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Sub-admin created successfully',
      admin: newAdmin
    })
  } catch (error: any) {
    console.error('Error in POST sub-admins:', error)
    return NextResponse.json(
      { error: 'Failed to create sub-admin' },
      { status: 500 }
    )
  }
}

// Update sub-admin
export async function PUT(request: NextRequest) {
  try {
    const admin = await getCurrentUserServer()
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 401 }
      )
    }

    // Verify admin is super_admin
    const { data: adminData } = await supabase
      .from('admin_users')
      .select('id, admin_type')
      .eq('email', admin.email)
      .single()

    if (adminData?.admin_type !== 'super_admin') {
      return NextResponse.json(
        { error: 'Only super admins can update sub-admins' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { id, name, departments, permissions, is_active } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Admin ID is required' },
        { status: 400 }
      )
    }

    // Check if trying to update a super_admin
    const { data: targetAdmin } = await supabase
      .from('admin_users')
      .select('admin_type')
      .eq('id', id)
      .single()

    if (targetAdmin?.admin_type === 'super_admin') {
      return NextResponse.json(
        { error: 'Cannot update super admin' },
        { status: 403 }
      )
    }

    // Validate departments if provided
    if (departments !== undefined) {
      if (!Array.isArray(departments) || departments.length === 0) {
        return NextResponse.json(
          { error: 'At least one department must be selected' },
          { status: 400 }
        )
      }
      const validDepartments = ['wallet', 'commission', 'mdr', 'limits', 'services', 'reversals', 'disputes', 'reports', 'users', 'settings', 'all']
      for (const dept of departments) {
        if (!validDepartments.includes(dept)) {
          return NextResponse.json(
            { error: `Invalid department: ${dept}` },
            { status: 400 }
          )
        }
      }
    }

    // Update admin
    const updateData: any = {}
    if (name) updateData.name = name
    if (departments !== undefined) {
      updateData.departments = departments
      // Also update single department for backward compatibility
      updateData.department = departments.includes('all') ? 'all' : departments[0]
    }
    if (permissions !== undefined) updateData.permissions = permissions
    if (is_active !== undefined) updateData.is_active = is_active

    const { data: updatedAdmin, error } = await supabase
      .from('admin_users')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating sub-admin:', error)
      return NextResponse.json(
        { error: 'Failed to update sub-admin' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Sub-admin updated successfully',
      admin: updatedAdmin
    })
  } catch (error: any) {
    console.error('Error in PUT sub-admins:', error)
    return NextResponse.json(
      { error: 'Failed to update sub-admin' },
      { status: 500 }
    )
  }
}

// Delete sub-admin
export async function DELETE(request: NextRequest) {
  try {
    const admin = await getCurrentUserServer()
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 401 }
      )
    }

    // Verify admin is super_admin
    const { data: adminData } = await supabase
      .from('admin_users')
      .select('id, admin_type')
      .eq('email', admin.email)
      .single()

    if (adminData?.admin_type !== 'super_admin') {
      return NextResponse.json(
        { error: 'Only super admins can delete sub-admins' },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Admin ID is required' },
        { status: 400 }
      )
    }

    // Check if trying to delete a super_admin
    const { data: targetAdmin } = await supabase
      .from('admin_users')
      .select('admin_type')
      .eq('id', id)
      .single()

    if (targetAdmin?.admin_type === 'super_admin') {
      return NextResponse.json(
        { error: 'Cannot delete super admin' },
        { status: 403 }
      )
    }

    // Delete auth user
    await supabase.auth.admin.deleteUser(id)

    // Delete admin record
    const { error } = await supabase
      .from('admin_users')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting sub-admin:', error)
      return NextResponse.json(
        { error: 'Failed to delete sub-admin' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Sub-admin deleted successfully'
    })
  } catch (error: any) {
    console.error('Error in DELETE sub-admins:', error)
    return NextResponse.json(
      { error: 'Failed to delete sub-admin' },
      { status: 500 }
    )
  }
}

