import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    // Get current admin user
    const admin = await getCurrentUserServer()
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { user_id, user_role, new_password } = body

    // Validation
    if (!user_id || !user_role || !new_password) {
      return NextResponse.json(
        { error: 'user_id, user_role, and new_password are required' },
        { status: 400 }
      )
    }

    if (!['retailer', 'distributor', 'master_distributor'].includes(user_role)) {
      return NextResponse.json(
        { error: 'Invalid user_role' },
        { status: 400 }
      )
    }

    if (new_password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      )
    }

    // Get the user to reset password for
    let tableName = ''
    switch (user_role) {
      case 'retailer':
        tableName = 'retailers'
        break
      case 'distributor':
        tableName = 'distributors'
        break
      case 'master_distributor':
        tableName = 'master_distributors'
        break
    }

    const { data: targetUser, error: userError } = await supabase
      .from(tableName)
      .select('email, partner_id')
      .eq('partner_id', user_id)
      .single()

    if (userError || !targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Find the auth user by email
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers()
    if (listError) {
      console.error('Error listing users:', listError)
      return NextResponse.json(
        { error: 'Failed to find user account' },
        { status: 500 }
      )
    }

    const authUser = users.find(u => u.email === targetUser.email)
    if (!authUser) {
      return NextResponse.json(
        { error: 'User authentication account not found' },
        { status: 404 }
      )
    }

    // Update password using admin API
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      authUser.id,
      { password: new_password }
    )

    if (updateError) {
      console.error('Error updating password:', updateError)
      return NextResponse.json(
        { error: updateError.message || 'Failed to reset password' },
        { status: 500 }
      )
    }

    // Get IP address and user agent for audit
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown'
    const userAgent = request.headers.get('user-agent') || 'unknown'

    // Log admin action in audit log (if table exists)
    try {
      const { data: adminData } = await supabase
        .from('admin_users')
        .select('id')
        .eq('email', admin.email)
        .single()

      if (adminData) {
        // Check if admin_audit_log table exists before inserting
        const { error: auditError } = await supabase
          .from('admin_audit_log')
          .insert({
            admin_id: adminData.id,
            action_type: 'password_reset',
            target_user_id: user_id,
            target_user_role: user_role,
            ip_address: ipAddress,
            user_agent: userAgent,
            remarks: `Password reset for ${targetUser.email}`
          })
        
        // Ignore audit log errors (table might not exist)
        if (auditError) {
          console.warn('Could not log password reset to audit log:', auditError)
        }
      }
    } catch (error) {
      // Ignore audit logging errors
      console.warn('Audit logging failed:', error)
    }

    return NextResponse.json({
      success: true,
      message: `Password reset successfully for ${targetUser.email}`
    })
  } catch (error: any) {
    console.error('Error in password reset:', error)
    return NextResponse.json(
      { error: 'Failed to reset password' },
      { status: 500 }
    )
  }
}

