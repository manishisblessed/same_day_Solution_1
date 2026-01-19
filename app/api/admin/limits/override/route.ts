import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

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

    const body = await request.json()
    const {
      user_id,
      user_role,
      wallet_type = 'primary',
      limit_type,
      override_all = false,
      override_reason
    } = body

    // Validation
    if (!user_id || !user_role || !limit_type) {
      return NextResponse.json(
        { error: 'user_id, user_role, and limit_type are required' },
        { status: 400 }
      )
    }

    if (!['retailer', 'distributor', 'master_distributor'].includes(user_role)) {
      return NextResponse.json(
        { error: 'Invalid user_role' },
        { status: 400 }
      )
    }

    if (!['primary', 'aeps'].includes(wallet_type)) {
      return NextResponse.json(
        { error: 'Invalid wallet_type' },
        { status: 400 }
      )
    }

    if (!['per_transaction', 'daily_transaction', 'daily_settlement'].includes(limit_type)) {
      return NextResponse.json(
        { error: 'Invalid limit_type' },
        { status: 400 }
      )
    }

    if (!override_reason) {
      return NextResponse.json(
        { error: 'override_reason is required when overriding limits' },
        { status: 400 }
      )
    }

    // Get IP address
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown'

    if (override_all) {
      // Override all limits for this user
      const limitTypes = ['per_transaction', 'daily_transaction', 'daily_settlement']
      
      for (const lt of limitTypes) {
        // Get or create limit entry
        const { data: existingLimit } = await supabase
          .from('user_limits')
          .select('id')
          .eq('user_id', user_id)
          .eq('user_role', user_role)
          .eq('wallet_type', wallet_type)
          .eq('limit_type', lt)
          .single()

        if (existingLimit) {
          await supabase
            .from('user_limits')
            .update({
              is_overridden: true,
              override_reason: override_reason,
              updated_at: new Date().toISOString()
            })
            .eq('id', existingLimit.id)
        } else {
          // Create new limit entry with override
          await supabase
            .from('user_limits')
            .insert({
              user_id: user_id,
              user_role: user_role,
              wallet_type: wallet_type,
              limit_type: lt,
              limit_amount: 999999999, // Very high limit
              is_enabled: true,
              is_overridden: true,
              override_reason: override_reason
            })
        }
      }
    } else {
      // Override specific limit
      const { data: existingLimit } = await supabase
        .from('user_limits')
        .select('id')
        .eq('user_id', user_id)
        .eq('user_role', user_role)
        .eq('wallet_type', wallet_type)
        .eq('limit_type', limit_type)
        .single()

      if (existingLimit) {
        await supabase
          .from('user_limits')
          .update({
            is_overridden: true,
            override_reason: override_reason,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingLimit.id)
      } else {
        // Create new limit entry with override
        await supabase
          .from('user_limits')
          .insert({
            user_id: user_id,
            user_role: user_role,
            wallet_type: wallet_type,
            limit_type: limit_type,
            limit_amount: 999999999, // Very high limit
            is_enabled: true,
            is_overridden: true,
            override_reason: override_reason
          })
      }
    }

    // Get wallet balance for audit
    const { data: walletBalance } = await supabase.rpc('get_wallet_balance_v2', {
      p_user_id: user_id,
      p_wallet_type: wallet_type
    })

    // Log admin action
    const { error: auditError } = await supabase
      .from('admin_audit_log')
      .insert({
        admin_id: admin.id,
        action_type: 'limit_override',
        target_user_id: user_id,
        target_user_role: user_role,
        wallet_type: wallet_type,
        before_balance: walletBalance || 0,
        after_balance: walletBalance || 0,
        ip_address: ipAddress,
        user_agent: request.headers.get('user-agent') || 'unknown',
        remarks: override_reason,
        metadata: {
          limit_type: override_all ? 'all' : limit_type,
          override_all: override_all
        }
      })

    if (auditError) {
      console.error('Error logging admin action:', auditError)
    }

    return NextResponse.json({
      success: true,
      message: override_all ? 'All limits overridden successfully' : 'Limit overridden successfully',
      limit_type: override_all ? 'all' : limit_type,
      override_reason: override_reason
    })
  } catch (error: any) {
    console.error('Error overriding limits:', error)
    return NextResponse.json(
      { error: 'Failed to override limits' },
      { status: 500 }
    )
  }
}

