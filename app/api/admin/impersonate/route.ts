import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export const runtime = 'nodejs' // Force Node.js runtime (Supabase not compatible with Edge Runtime)
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    // Initialize Supabase client at runtime (not during build)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Supabase configuration missing' },
        { status: 500 }
      )
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    
    // Get current admin user
    const admin = await getCurrentUserServer()
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 401 }
      )
    }

    // Verify admin exists (check if is_active column exists, if not, assume active)
    const { data: adminData, error: adminError } = await supabase
      .from('admin_users')
      .select('id, admin_type, is_active')
      .eq('email', admin.email)
      .single()

    if (adminError || !adminData) {
      return NextResponse.json(
        { error: 'Admin account not found' },
        { status: 403 }
      )
    }

    // Check if admin is active (only if column exists and is set)
    if (adminData.is_active === false) {
      return NextResponse.json(
        { error: 'Admin account is inactive' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { user_id, user_role } = body

    if (!user_id || !user_role) {
      return NextResponse.json(
        { error: 'user_id and user_role are required' },
        { status: 400 }
      )
    }

    if (!['retailer', 'distributor', 'master_distributor'].includes(user_role)) {
      return NextResponse.json(
        { error: 'Invalid user_role' },
        { status: 400 }
      )
    }

    // Get the user to impersonate
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
      .select('*')
      .eq('partner_id', user_id)
      .single()

    if (userError || !targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Check if user is active
    if (targetUser.status !== 'active') {
      return NextResponse.json(
        { error: 'Cannot impersonate inactive user' },
        { status: 403 }
      )
    }

    // Get IP address and user agent
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown'
    const userAgent = request.headers.get('user-agent') || 'unknown'

    // Create impersonation session
    const { data: session, error: sessionError } = await supabase
      .from('admin_impersonation_sessions')
      .insert({
        admin_id: adminData.id,
        impersonated_user_id: user_id,
        impersonated_user_role: user_role,
        impersonated_user_email: targetUser.email,
        ip_address: ipAddress,
        user_agent: userAgent,
        is_active: true
      })
      .select()
      .single()

    if (sessionError) {
      console.error('Error creating impersonation session:', sessionError)
      return NextResponse.json(
        { error: 'Failed to create impersonation session' },
        { status: 500 }
      )
    }

    // Create a session token for the impersonated user
    // We'll use a special token that indicates impersonation
    const impersonationToken = `impersonate_${session.id}_${Date.now()}`

    // Return user data and token
    return NextResponse.json({
      success: true,
      message: `Successfully logged in as ${targetUser.name}`,
      user: {
        id: targetUser.id,
        email: targetUser.email,
        name: targetUser.name,
        role: user_role,
        partner_id: targetUser.partner_id,
        is_impersonated: true,
        original_admin_id: adminData.id,
        impersonation_session_id: session.id
      },
      impersonation_token: impersonationToken,
      redirect_url: user_role === 'retailer' ? '/dashboard/retailer' :
                    user_role === 'distributor' ? '/dashboard/distributor' :
                    '/dashboard/master-distributor'
    })
  } catch (error: any) {
    console.error('Error in impersonation:', error)
    return NextResponse.json(
      { error: 'Failed to impersonate user' },
      { status: 500 }
    )
  }
}

// End impersonation session
export async function DELETE(request: NextRequest) {
  try {
    // Initialize Supabase client at runtime (not during build)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Supabase configuration missing' },
        { status: 500 }
      )
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    
    const admin = await getCurrentUserServer()
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('session_id')

    if (!sessionId) {
      return NextResponse.json(
        { error: 'session_id is required' },
        { status: 400 }
      )
    }

    // End the impersonation session
    const { error } = await supabase
      .from('admin_impersonation_sessions')
      .update({
        is_active: false,
        ended_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .eq('admin_id', (await supabase.from('admin_users').select('id').eq('email', admin.email).single()).data?.id)

    if (error) {
      return NextResponse.json(
        { error: 'Failed to end impersonation session' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Impersonation session ended'
    })
  } catch (error: any) {
    console.error('Error ending impersonation:', error)
    return NextResponse.json(
      { error: 'Failed to end impersonation session' },
      { status: 500 }
    )
  }
}

