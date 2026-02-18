import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { apiHandler } from '@/lib/api-wrapper'

export const runtime = 'nodejs'
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

async function handleSetPartnerPassword(request: NextRequest) {
  const supabase = getSupabaseClient()
  
  try {
    // Get current admin user with fallback authentication
    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Set Partner Password] Auth method:', method, '| User:', admin?.email || 'none')
    
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
          message: `Your role (${admin.role}) does not have permission to set partner passwords. Admin access required.`,
          code: 'INSUFFICIENT_PERMISSIONS'
        },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { partner_id, password } = body

    // Validation
    if (!partner_id || !password) {
      return NextResponse.json(
        { error: 'partner_id and password are required' },
        { status: 400 }
      )
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      )
    }

    // Get the partner to set password for
    const { data: partner, error: partnerError } = await supabase
      .from('partners')
      .select('email, name')
      .eq('id', partner_id)
      .single()

    if (partnerError || !partner) {
      return NextResponse.json(
        { error: 'Partner not found' },
        { status: 404 }
      )
    }

    // Check if auth user already exists
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers()
    if (listError) {
      console.error('Error listing users:', listError)
      return NextResponse.json(
        { error: 'Failed to find user account' },
        { status: 500 }
      )
    }

    const existingAuthUser = users.find(u => u.email === partner.email)

    if (existingAuthUser) {
      // Update existing user's password
      const { error: updateError } = await supabase.auth.admin.updateUserById(
        existingAuthUser.id,
        { password }
      )

      if (updateError) {
        console.error('Error updating password:', updateError)
        return NextResponse.json(
          { error: updateError.message || 'Failed to update password' },
          { status: 500 }
        )
      }
    } else {
      // Create new auth user
      const { error: createError } = await supabase.auth.admin.createUser({
        email: partner.email,
        password,
        email_confirm: true,
      })

      if (createError) {
        console.error('Error creating user:', createError)
        return NextResponse.json(
          { error: createError.message || 'Failed to create user account' },
          { status: 500 }
        )
      }
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
            action_type: 'set_partner_password',
            target_user_id: partner_id,
            target_user_role: 'partner',
            ip_address: ipAddress,
            user_agent: userAgent,
            remarks: `Password set for partner ${partner.email}`
          })
        
        // Ignore audit log errors (table might not exist)
        if (auditError) {
          console.warn('Could not log password set to audit log:', auditError)
        }
      }
    } catch (error) {
      // Ignore audit logging errors
      console.warn('Audit logging failed:', error)
    }

    return NextResponse.json({
      success: true,
      message: `Password set successfully for partner ${partner.email}`
    })
  } catch (error: any) {
    console.error('[Set Partner Password] Error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to set password',
        message: error?.message || 'An error occurred while setting password'
      },
      { status: 500 }
    )
  }
}

// Export wrapped handler
export const POST = apiHandler(handleSetPartnerPassword)

