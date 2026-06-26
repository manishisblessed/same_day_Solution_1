import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { apiHandler } from '@/lib/api-wrapper'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

export const runtime = 'nodejs' // Force Node.js runtime (Supabase not compatible with Edge Runtime)
export const dynamic = 'force-dynamic'

// Helper to get Supabase client safely
function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is missing')
  }

  if (!supabaseServiceKey || supabaseServiceKey.trim() === '' || supabaseServiceKey === 'your_supabase_service_role_key') {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing or invalid')
  }

  return createClient(supabaseUrl, supabaseServiceKey)
}

async function handleResetPassword(request: NextRequest) {
  const supabase = getSupabaseClient()
  
  try {
    // Get current admin user with fallback authentication
    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Reset Password] Auth method:', method, '| User:', admin?.email || 'none')
    
    if (!admin) {
      return NextResponse.json(
        { 
          error: 'Session expired or not found',
          message: 'Your session has expired. Please log out and log back in.',
          code: 'SESSION_EXPIRED',
          action: 'RELOGIN'
        },
        { status: 401 }
      )
    }
    
    if (admin.role !== 'admin') {
      return NextResponse.json(
        { 
          error: 'Insufficient permissions',
          message: `Your role (${admin.role}) does not have permission to reset passwords. Admin access required.`,
          code: 'INSUFFICIENT_PERMISSIONS'
        },
        { status: 403 }
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

    const VALID_ROLES = ['retailer', 'distributor', 'master_distributor', 'admin', 'finance_executive', 'partner']
    if (!VALID_ROLES.includes(user_role)) {
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

    // Resolve the profile table and lookup key based on role
    const roleConfig: Record<string, { table: string; lookupField: string }> = {
      retailer: { table: 'retailers', lookupField: 'partner_id' },
      distributor: { table: 'distributors', lookupField: 'partner_id' },
      master_distributor: { table: 'master_distributors', lookupField: 'partner_id' },
      admin: { table: 'admin_users', lookupField: 'id' },
      finance_executive: { table: 'finance_users', lookupField: 'id' },
      partner: { table: 'partners', lookupField: 'id' },
    }

    const { table: tableName, lookupField } = roleConfig[user_role]

    const { data: targetUser, error: userError } = await supabase
      .from(tableName)
      .select('email')
      .eq(lookupField, user_id)
      .single()

    if (userError || !targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Prevent admin from resetting their own password via this route
    if (targetUser.email.toLowerCase() === admin.email.toLowerCase()) {
      return NextResponse.json(
        { error: 'Use the Change Password page to update your own password' },
        { status: 400 }
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

    // Clear login lockout so the user can log in immediately
    try {
      await supabase.from('login_attempts').delete()
        .eq('email', targetUser.email.toLowerCase())
        .eq('success', false)
        .gte('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
    } catch {
      // non-fatal — lockout will expire naturally
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

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, admin, {
      activity_type: 'admin_reset_password',
      activity_category: 'admin',
      activity_description: `Admin reset password for user ${targetUser.email}`,
      metadata: { target_user_id: user_id, target_user_role: user_role },
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      message: `Password reset successfully for ${targetUser.email}`
    })
  } catch (error: any) {
    console.error('[Reset Password] Error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to reset password',
        message: error?.message || 'An error occurred while resetting password'
      },
      { status: 500 }
    )
  }
}

// Export wrapped handler
export const POST = apiHandler(handleResetPassword)

