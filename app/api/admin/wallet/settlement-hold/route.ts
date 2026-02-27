import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { addCorsHeaders } from '@/lib/cors'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

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
    
    // Get current admin user with fallback
    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Settlement Hold] Auth method:', method, '| User:', admin?.email || 'none')
    
    if (!admin) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const {
      user_id,
      hold = true,
      remarks
    } = body

    // Validation
    if (!user_id) {
      return NextResponse.json(
        { error: 'user_id is required' },
        { status: 400 }
      )
    }

    // Settlement hold only applies to PRIMARY wallet
    const wallet_type = 'primary'

    // Get IP address
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown'

    // Get current wallet state
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('is_settlement_held, balance, user_role')
      .eq('user_id', user_id)
      .eq('wallet_type', wallet_type)
      .single()

    if (walletError || !wallet) {
      return NextResponse.json(
        { error: 'Primary wallet not found' },
        { status: 404 }
      )
    }

    // Update settlement hold status
    const { error: updateError } = await supabase
      .from('wallets')
      .update({ is_settlement_held: hold, updated_at: new Date().toISOString() })
      .eq('user_id', user_id)
      .eq('wallet_type', wallet_type)

    if (updateError) {
      console.error('Error updating settlement hold status:', updateError)
      return NextResponse.json(
        { error: 'Failed to update settlement hold status' },
        { status: 500 }
      )
    }

    // Log admin action
    const { error: auditError } = await supabase
      .from('admin_audit_log')
      .insert({
        admin_id: admin.id,
        action_type: hold ? 'settlement_hold' : 'settlement_release',
        target_user_id: user_id,
        target_user_role: wallet.user_role,
        wallet_type: wallet_type,
        before_balance: wallet.balance,
        after_balance: wallet.balance,
        ip_address: ipAddress,
        user_agent: request.headers.get('user-agent') || 'unknown',
        remarks: remarks || (hold ? 'Settlement held by admin' : 'Settlement released by admin')
      })

    if (auditError) {
      console.error('Error logging admin action:', auditError)
      // Don't fail the request if audit logging fails
    }

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, admin, {
      activity_type: 'admin_settlement_hold',
      activity_category: 'admin',
      activity_description: `Admin toggled settlement hold for ${wallet.user_role} ${user_id}`,
      reference_table: 'wallets',
      metadata: { target_user_id: user_id, target_user_role: wallet.user_role, hold, remarks },
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      message: hold ? 'Settlement held successfully' : 'Settlement released successfully',
      is_settlement_held: hold
    })
  } catch (error: any) {
    console.error('Error holding/releasing settlement:', error)
    return NextResponse.json(
      { error: 'Failed to update settlement hold status' },
      { status: 500 }
    )
  }
}

