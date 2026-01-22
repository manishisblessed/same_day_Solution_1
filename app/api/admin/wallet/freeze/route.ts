import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { addCorsHeaders } from '@/lib/cors'

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
    console.log('[Wallet Freeze] Auth method:', method, '| User:', admin?.email || 'none')
    
    if (!admin) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const {
      user_id,
      wallet_type = 'primary',
      freeze = true,
      remarks
    } = body

    // Validation
    if (!user_id) {
      return NextResponse.json(
        { error: 'user_id is required' },
        { status: 400 }
      )
    }

    if (!['primary', 'aeps'].includes(wallet_type)) {
      return NextResponse.json(
        { error: 'Invalid wallet_type' },
        { status: 400 }
      )
    }

    // Get IP address
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown'

    // Get current wallet state
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('is_frozen, balance, user_role')
      .eq('user_id', user_id)
      .eq('wallet_type', wallet_type)
      .single()

    if (walletError || !wallet) {
      return NextResponse.json(
        { error: 'Wallet not found' },
        { status: 404 }
      )
    }

    // Update freeze status
    const { error: updateError } = await supabase
      .from('wallets')
      .update({ is_frozen: freeze, updated_at: new Date().toISOString() })
      .eq('user_id', user_id)
      .eq('wallet_type', wallet_type)

    if (updateError) {
      console.error('Error updating wallet freeze status:', updateError)
      return NextResponse.json(
        { error: 'Failed to update wallet freeze status' },
        { status: 500 }
      )
    }

    // Log admin action
    const { error: auditError } = await supabase
      .from('admin_audit_log')
      .insert({
        admin_id: admin.id,
        action_type: freeze ? 'wallet_freeze' : 'wallet_unfreeze',
        target_user_id: user_id,
        target_user_role: wallet.user_role,
        wallet_type: wallet_type,
        before_balance: wallet.balance,
        after_balance: wallet.balance,
        ip_address: ipAddress,
        user_agent: request.headers.get('user-agent') || 'unknown',
        remarks: remarks || (freeze ? 'Wallet frozen by admin' : 'Wallet unfrozen by admin')
      })

    if (auditError) {
      console.error('Error logging admin action:', auditError)
      // Don't fail the request if audit logging fails
    }

    return NextResponse.json({
      success: true,
      message: freeze ? 'Wallet frozen successfully' : 'Wallet unfrozen successfully',
      wallet_type: wallet_type,
      is_frozen: freeze
    })
  } catch (error: any) {
    console.error('Error freezing/unfreezing wallet:', error)
    return NextResponse.json(
      { error: 'Failed to update wallet freeze status' },
      { status: 500 }
    )
  }
}

