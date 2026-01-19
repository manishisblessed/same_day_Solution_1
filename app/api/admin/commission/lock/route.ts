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
      commission_id,
      lock = true,
      fund_category = 'commission',
      remarks
    } = body

    // Validation
    if (!commission_id) {
      return NextResponse.json(
        { error: 'commission_id is required' },
        { status: 400 }
      )
    }

    // Get IP address
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown'

    // Get commission details
    const { data: commission, error: commissionError } = await supabase
      .from('commission_ledger')
      .select('*, user_id, user_role, commission_amount')
      .eq('id', commission_id)
      .single()

    if (commissionError || !commission) {
      return NextResponse.json(
        { error: 'Commission not found' },
        { status: 404 }
      )
    }

    // Update lock status
    const { error: updateError } = await supabase
      .from('commission_ledger')
      .update({ is_locked: lock, updated_at: new Date().toISOString() })
      .eq('id', commission_id)

    if (updateError) {
      console.error('Error updating commission lock status:', updateError)
      return NextResponse.json(
        { error: 'Failed to update commission lock status' },
        { status: 500 }
      )
    }

    // Get wallet balance for audit
    const { data: walletBalance } = await supabase.rpc('get_wallet_balance_v2', {
      p_user_id: commission.user_id,
      p_wallet_type: 'primary'
    })

    // Log admin action
    const { error: auditError } = await supabase
      .from('admin_audit_log')
      .insert({
        admin_id: admin.id,
        action_type: lock ? 'commission_lock' : 'commission_unlock',
        target_user_id: commission.user_id,
        target_user_role: commission.user_role,
        wallet_type: 'primary',
        fund_category: fund_category,
        amount: commission.commission_amount,
        before_balance: walletBalance || 0,
        after_balance: walletBalance || 0,
        ip_address: ipAddress,
        user_agent: request.headers.get('user-agent') || 'unknown',
        remarks: remarks || (lock ? 'Commission locked by admin' : 'Commission unlocked by admin'),
        metadata: { commission_id: commission_id }
      })

    if (auditError) {
      console.error('Error logging admin action:', auditError)
      // Don't fail the request if audit logging fails
    }

    return NextResponse.json({
      success: true,
      message: lock ? 'Commission locked successfully' : 'Commission unlocked successfully',
      is_locked: lock
    })
  } catch (error: any) {
    console.error('Error locking/unlocking commission:', error)
    return NextResponse.json(
      { error: 'Failed to update commission lock status' },
      { status: 500 }
    )
  }
}

