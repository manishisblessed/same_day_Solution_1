import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

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
      dispute_id,
      action, // 'hold', 'resolve', 'reject'
      resolution,
      remarks
    } = body

    // Validation
    if (!dispute_id || !action) {
      return NextResponse.json(
        { error: 'dispute_id and action are required' },
        { status: 400 }
      )
    }

    if (!['hold', 'resolve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be "hold", "resolve", or "reject"' },
        { status: 400 }
      )
    }

    // Get IP address
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown'

    // Get dispute
    const { data: dispute, error: disputeError } = await supabase
      .from('disputes')
      .select('*, transaction_id, transaction_type, user_id, user_role')
      .eq('id', dispute_id)
      .single()

    if (disputeError || !dispute) {
      return NextResponse.json(
        { error: 'Dispute not found' },
        { status: 404 }
      )
    }

    // Determine wallet type based on transaction type
    const wallet_type = dispute.transaction_type === 'aeps' ? 'aeps' : 'primary'

    // Get wallet balance for audit
    const { data: walletBalance } = await supabase.rpc('get_wallet_balance_v2', {
      p_user_id: dispute.user_id,
      p_wallet_type: wallet_type
    })

    let updateData: any = {
      updated_at: new Date().toISOString()
    }

    if (action === 'hold') {
      updateData.status = 'hold'
      updateData.resolution = resolution || 'Transaction held pending investigation'
    } else if (action === 'resolve') {
      if (!resolution) {
        return NextResponse.json(
          { error: 'resolution is required when resolving dispute' },
          { status: 400 }
        )
      }
      updateData.status = 'resolved'
      updateData.resolution = resolution
      updateData.resolved_by = admin.id
      updateData.resolved_at = new Date().toISOString()
    } else if (action === 'reject') {
      updateData.status = 'rejected'
      updateData.resolution = resolution || 'Dispute rejected'
      updateData.resolved_by = admin.id
      updateData.resolved_at = new Date().toISOString()
    }

    // Update dispute
    const { error: updateError } = await supabase
      .from('disputes')
      .update(updateData)
      .eq('id', dispute_id)

    if (updateError) {
      console.error('Error updating dispute:', updateError)
      return NextResponse.json(
        { error: 'Failed to update dispute' },
        { status: 500 }
      )
    }

    // If holding, also hold the related transaction ledger entry
    if (action === 'hold') {
      // Get the ledger entry for the transaction
      let ledgerEntryId: string | null = null

      if (dispute.transaction_type === 'bbps') {
        const { data: tx } = await supabase
          .from('bbps_transactions')
          .select('wallet_debit_id')
          .eq('id', dispute.transaction_id)
          .single()
        ledgerEntryId = tx?.wallet_debit_id || null
      } else if (dispute.transaction_type === 'aeps') {
        const { data: tx } = await supabase
          .from('aeps_transactions')
          .select('wallet_debit_id')
          .eq('id', dispute.transaction_id)
          .single()
        ledgerEntryId = tx?.wallet_debit_id || null
      } else if (dispute.transaction_type === 'settlement') {
        const { data: tx } = await supabase
          .from('settlements')
          .select('ledger_entry_id')
          .eq('id', dispute.transaction_id)
          .single()
        ledgerEntryId = tx?.ledger_entry_id || null
      }

      // Update ledger entry status to 'hold'
      if (ledgerEntryId) {
        await supabase
          .from('wallet_ledger')
          .update({ status: 'hold' })
          .eq('id', ledgerEntryId)
      }
    }

    // Log admin action
    const { error: auditError } = await supabase
      .from('admin_audit_log')
      .insert({
        admin_id: admin.id,
        action_type: `dispute_${action}`,
        target_user_id: dispute.user_id,
        target_user_role: dispute.user_role,
        wallet_type: wallet_type,
        before_balance: walletBalance || 0,
        after_balance: walletBalance || 0,
        ip_address: ipAddress,
        user_agent: request.headers.get('user-agent') || 'unknown',
        remarks: remarks || `Dispute ${action} - ${resolution || ''}`,
        metadata: {
          dispute_id: dispute_id,
          transaction_id: dispute.transaction_id,
          transaction_type: dispute.transaction_type,
          action: action,
          resolution: resolution
        }
      })

    if (auditError) {
      console.error('Error logging admin action:', auditError)
    }

    return NextResponse.json({
      success: true,
      message: `Dispute ${action} successfully`,
      dispute_id: dispute_id,
      status: updateData.status,
      resolution: updateData.resolution
    })
  } catch (error: any) {
    console.error('Error handling dispute:', error)
    return NextResponse.json(
      { error: 'Failed to handle dispute' },
      { status: 500 }
    )
  }
}

