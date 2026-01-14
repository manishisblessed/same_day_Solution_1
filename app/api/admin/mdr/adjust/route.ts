import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// MDR caps configuration
const MDR_CAPS = {
  retailer: { min: 0.005, max: 0.05 }, // 0.5% to 5%
  distributor: { min: 0.003, max: 0.03 }, // 0.3% to 3%
  master_distributor: { min: 0.001, max: 0.02 } // 0.1% to 2%
}

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
    const {
      user_id,
      user_role,
      new_mdr_rate,
      remarks
    } = body

    // Validation
    if (!user_id || !user_role || new_mdr_rate === undefined) {
      return NextResponse.json(
        { error: 'user_id, user_role, and new_mdr_rate are required' },
        { status: 400 }
      )
    }

    if (!['retailer', 'distributor', 'master_distributor'].includes(user_role)) {
      return NextResponse.json(
        { error: 'Invalid user_role' },
        { status: 400 }
      )
    }

    const mdrRateDecimal = parseFloat(new_mdr_rate)
    if (isNaN(mdrRateDecimal) || mdrRateDecimal < 0 || mdrRateDecimal > 1) {
      return NextResponse.json(
        { error: 'MDR rate must be between 0 and 1 (e.g., 0.015 for 1.5%)' },
        { status: 400 }
      )
    }

    // Check MDR caps
    const caps = MDR_CAPS[user_role as keyof typeof MDR_CAPS]
    if (mdrRateDecimal < caps.min || mdrRateDecimal > caps.max) {
      return NextResponse.json(
        { 
          error: `MDR rate must be between ${(caps.min * 100).toFixed(1)}% and ${(caps.max * 100).toFixed(1)}%`,
          min_rate: caps.min,
          max_rate: caps.max
        },
        { status: 400 }
      )
    }

    // Get IP address
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown'

    // Get current MDR rate
    let currentMdrRate: number | null = null
    let tableName = ''
    let updateField = ''

    if (user_role === 'retailer') {
      tableName = 'retailers'
      updateField = 'retailer_mdr_rate'
      const { data: user } = await supabase
        .from(tableName)
        .select('retailer_mdr_rate')
        .eq('partner_id', user_id)
        .single()
      
      if (!user) {
        return NextResponse.json(
          { error: 'User not found' },
          { status: 404 }
        )
      }
      currentMdrRate = parseFloat((user.retailer_mdr_rate || 0).toString())
    } else if (user_role === 'distributor') {
      tableName = 'distributors'
      updateField = 'approved_mdr_rate'
      const { data: user } = await supabase
        .from(tableName)
        .select('approved_mdr_rate')
        .eq('partner_id', user_id)
        .single()
      
      if (!user) {
        return NextResponse.json(
          { error: 'User not found' },
          { status: 404 }
        )
      }
      currentMdrRate = parseFloat((user.approved_mdr_rate || 0).toString())
    } else if (user_role === 'master_distributor') {
      tableName = 'master_distributors'
      updateField = 'approved_mdr_rate'
      const { data: user } = await supabase
        .from(tableName)
        .select('approved_mdr_rate')
        .eq('partner_id', user_id)
        .single()
      
      if (!user) {
        return NextResponse.json(
          { error: 'User not found' },
          { status: 404 }
        )
      }
      currentMdrRate = parseFloat((user.approved_mdr_rate || 0).toString())
    }

    // Update MDR rate
    const { error: updateError } = await supabase
      .from(tableName)
      .update({ 
        [updateField]: mdrRateDecimal,
        updated_at: new Date().toISOString()
      })
      .eq('partner_id', user_id)

    if (updateError) {
      console.error('Error updating MDR rate:', updateError)
      return NextResponse.json(
        { error: 'Failed to update MDR rate' },
        { status: 500 }
      )
    }

    // Get wallet balance for audit
    const { data: walletBalance } = await supabase.rpc('get_wallet_balance_v2', {
      p_user_id: user_id,
      p_wallet_type: 'primary'
    })

    // Log admin action
    const { error: auditError } = await supabase
      .from('admin_audit_log')
      .insert({
        admin_id: admin.id,
        action_type: 'mdr_adjust',
        target_user_id: user_id,
        target_user_role: user_role,
        wallet_type: 'primary',
        before_balance: walletBalance || 0,
        after_balance: walletBalance || 0,
        ip_address: ipAddress,
        user_agent: request.headers.get('user-agent') || 'unknown',
        remarks: remarks || `MDR adjusted from ${currentMdrRate !== null ? (currentMdrRate * 100).toFixed(2) : '0.00'}% to ${(mdrRateDecimal * 100).toFixed(2)}%`,
        metadata: {
          previous_mdr_rate: currentMdrRate,
          new_mdr_rate: mdrRateDecimal,
          mdr_field: updateField
        }
      })

    if (auditError) {
      console.error('Error logging admin action:', auditError)
    }

    return NextResponse.json({
      success: true,
      message: 'MDR rate adjusted successfully',
      previous_mdr_rate: currentMdrRate,
      new_mdr_rate: mdrRateDecimal,
      mdr_percentage: (mdrRateDecimal * 100).toFixed(2) + '%'
    })
  } catch (error: any) {
    console.error('Error adjusting MDR:', error)
    return NextResponse.json(
      { error: 'Failed to adjust MDR rate' },
      { status: 500 }
    )
  }
}

