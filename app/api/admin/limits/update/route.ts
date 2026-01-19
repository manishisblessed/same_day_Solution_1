import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
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
      limit_amount,
      is_enabled = true,
      is_overridden = false,
      override_reason
    } = body

    // Validation
    if (!user_id || !user_role || !limit_type || limit_amount === undefined) {
      return NextResponse.json(
        { error: 'user_id, user_role, limit_type, and limit_amount are required' },
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

    const amountDecimal = parseFloat(limit_amount)
    if (isNaN(amountDecimal) || amountDecimal < 0) {
      return NextResponse.json(
        { error: 'Invalid limit_amount' },
        { status: 400 }
      )
    }

    // Get IP address
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown'

    // Upsert limit
    const { data: limit, error: limitError } = await supabase
      .from('user_limits')
      .upsert({
        user_id: user_id,
        user_role: user_role,
        wallet_type: wallet_type,
        limit_type: limit_type,
        limit_amount: amountDecimal,
        is_enabled: is_enabled,
        is_overridden: is_overridden,
        override_by: is_overridden ? admin.id : null,
        override_reason: override_reason || null,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,wallet_type,limit_type'
      })
      .select()
      .single()

    if (limitError) {
      console.error('Error updating limit:', limitError)
      return NextResponse.json(
        { error: 'Failed to update limit' },
        { status: 500 }
      )
    }

    // Log admin action
    const { error: auditError } = await supabase
      .from('admin_audit_log')
      .insert({
        admin_id: admin.id,
        action_type: 'limit_update',
        target_user_id: user_id,
        target_user_role: user_role,
        wallet_type: wallet_type,
        amount: amountDecimal,
        ip_address: ipAddress,
        user_agent: request.headers.get('user-agent') || 'unknown',
        remarks: `Limit updated - Type: ${limit_type}, Amount: ₹${amountDecimal}, Enabled: ${is_enabled}, Overridden: ${is_overridden}`,
        metadata: {
          limit_type: limit_type,
          is_enabled: is_enabled,
          is_overridden: is_overridden,
          override_reason: override_reason
        }
      })

    if (auditError) {
      console.error('Error logging admin action:', auditError)
      // Don't fail the request if audit logging fails
    }

    return NextResponse.json({
      success: true,
      message: 'Limit updated successfully',
      limit: limit
    })
  } catch (error: any) {
    console.error('Error updating limit:', error)
    return NextResponse.json(
      { error: 'Failed to update limit' },
      { status: 500 }
    )
  }
}

