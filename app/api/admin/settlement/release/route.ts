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

    // Check permission
    const { data: hasPermission } = await supabase.rpc('check_admin_permission', {
      p_admin_id: admin.id,
      p_permission_key: 'settlement.release'
    })

    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Unauthorized: You do not have permission to release settlements' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { settlement_id, action } = body // action: 'approve' or 'reject'

    // Validation
    if (!settlement_id || !action) {
      return NextResponse.json(
        { error: 'settlement_id and action are required' },
        { status: 400 }
      )
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be "approve" or "reject"' },
        { status: 400 }
      )
    }

    // Get IP address
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown'

    // Get settlement details
    const { data: settlement, error: settlementError } = await supabase
      .from('settlements')
      .select('*')
      .eq('id', settlement_id)
      .single()

    if (settlementError || !settlement) {
      return NextResponse.json(
        { error: 'Settlement not found' },
        { status: 404 }
      )
    }

    // Check if settlement is in pending or processing state
    if (!['pending', 'processing'].includes(settlement.status)) {
      return NextResponse.json(
        { error: `Settlement is already ${settlement.status}. Cannot release.` },
        { status: 400 }
      )
    }

    if (action === 'approve') {
      // Process the payout
      // TODO: Call actual payout API here (RazorpayX, etc.)
      const payoutSuccess = true // Placeholder

      if (payoutSuccess) {
        // Update settlement status
        const { error: updateError } = await supabase
          .from('settlements')
          .update({
            status: 'success',
            processed_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            payout_reference_id: `PAYOUT_${Date.now()}`,
            updated_at: new Date().toISOString()
          })
          .eq('id', settlement_id)

        if (updateError) {
          console.error('Error updating settlement:', updateError)
          return NextResponse.json(
            { error: 'Failed to update settlement' },
            { status: 500 }
          )
        }

        // Update ledger status if exists
        if (settlement.ledger_entry_id) {
          await supabase
            .from('wallet_ledger')
            .update({ status: 'completed' })
            .eq('id', settlement.ledger_entry_id)
        }

        // Log admin action
        await supabase
          .from('admin_audit_log')
          .insert({
            admin_id: admin.id,
            action_type: 'settlement_approve',
            target_user_id: settlement.user_id,
            target_user_role: settlement.user_role,
            wallet_type: 'primary',
            amount: settlement.amount,
            before_balance: 0, // Settlement already debited
            after_balance: 0,
            ip_address: ipAddress,
            user_agent: request.headers.get('user-agent') || 'unknown',
            remarks: `Settlement approved and released - Amount: ₹${settlement.amount}`,
            metadata: {
              settlement_id: settlement_id,
              settlement_mode: settlement.settlement_mode,
              payout_reference_id: `PAYOUT_${Date.now()}`
            }
          })

        return NextResponse.json({
          success: true,
          message: 'Settlement approved and released successfully',
          settlement_id: settlement_id,
          payout_reference_id: `PAYOUT_${Date.now()}`
        })
      } else {
        // Payout failed
        await supabase
          .from('settlements')
          .update({
            status: 'failed',
            failure_reason: 'Payout API failed',
            updated_at: new Date().toISOString()
          })
          .eq('id', settlement_id)

        return NextResponse.json(
          { error: 'Payout processing failed' },
          { status: 500 }
        )
      }
    } else {
      // Reject settlement - reverse the debit
      const { error: reversalError } = await supabase.rpc('add_ledger_entry', {
        p_user_id: settlement.user_id,
        p_user_role: settlement.user_role,
        p_wallet_type: 'primary',
        p_fund_category: 'settlement',
        p_service_type: 'settlement',
        p_tx_type: 'REFUND',
        p_credit: settlement.amount,
        p_debit: 0,
        p_reference_id: `SETTLEMENT_REJECT_${settlement.id}`,
        p_status: 'completed',
        p_remarks: `Settlement rejected by admin - Reversal`
      })

      if (reversalError) {
        console.error('Error reversing settlement:', reversalError)
        return NextResponse.json(
          { error: 'Failed to reverse settlement' },
          { status: 500 }
        )
      }

      // Update settlement status
      await supabase
        .from('settlements')
        .update({
          status: 'reversed',
          updated_at: new Date().toISOString()
        })
        .eq('id', settlement_id)

      // Log admin action
      await supabase
        .from('admin_audit_log')
        .insert({
          admin_id: admin.id,
          action_type: 'settlement_reject',
          target_user_id: settlement.user_id,
          target_user_role: settlement.user_role,
          wallet_type: 'primary',
          amount: settlement.amount,
          before_balance: 0,
          after_balance: 0,
          ip_address: ipAddress,
          user_agent: request.headers.get('user-agent') || 'unknown',
          remarks: `Settlement rejected by admin - Amount: ₹${settlement.amount}`,
          metadata: {
            settlement_id: settlement_id
          }
        })

      return NextResponse.json({
        success: true,
        message: 'Settlement rejected and reversed successfully',
        settlement_id: settlement_id
      })
    }
  } catch (error: any) {
    console.error('Error releasing settlement:', error)
    return NextResponse.json(
      { error: 'Failed to release settlement' },
      { status: 500 }
    )
  }
}

