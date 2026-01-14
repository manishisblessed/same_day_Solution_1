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
      transaction_id,
      reason,
      remarks
    } = body

    // Validation
    if (!transaction_id || !reason) {
      return NextResponse.json(
        { error: 'transaction_id and reason are required' },
        { status: 400 }
      )
    }

    // Get IP address
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown'

    // Get BBPS transaction
    const { data: tx, error: txError } = await supabase
      .from('bbps_transactions')
      .select('id, retailer_id, bill_amount, wallet_debit_id, status')
      .eq('id', transaction_id)
      .single()

    if (txError || !tx) {
      return NextResponse.json(
        { error: 'BBPS transaction not found' },
        { status: 404 }
      )
    }

    if (tx.status === 'reversed') {
      return NextResponse.json(
        { error: 'Transaction already reversed' },
        { status: 400 }
      )
    }

    if (tx.status === 'success') {
      return NextResponse.json(
        { error: 'Cannot reverse successful transaction. Use general reversal endpoint.' },
        { status: 400 }
      )
    }

    const user_id = tx.retailer_id
    const user_role = 'retailer'
    const amount = parseFloat(tx.bill_amount.toString())
    const wallet_type = 'primary'
    const original_ledger_id = tx.wallet_debit_id

    // Get before balance
    const { data: beforeBalance } = await supabase.rpc('get_wallet_balance_v2', {
      p_user_id: user_id,
      p_wallet_type: wallet_type
    })

    // Create reversal record
    const { data: reversal, error: reversalError } = await supabase
      .from('reversals')
      .insert({
        original_transaction_id: transaction_id,
        transaction_type: 'bbps',
        user_id: user_id,
        user_role: user_role,
        original_amount: amount,
        reversal_amount: amount,
        reason: reason,
        status: 'processing',
        original_ledger_id: original_ledger_id,
        admin_id: admin.id,
        ip_address: ipAddress,
        remarks: remarks || `BBPS failure reversal - ${reason}`
      })
      .select()
      .single()

    if (reversalError || !reversal) {
      console.error('Error creating reversal:', reversalError)
      return NextResponse.json(
        { error: 'Failed to create reversal' },
        { status: 500 }
      )
    }

    // Reverse the transaction - credit wallet
    const { data: reversalLedgerId, error: ledgerError } = await supabase.rpc('add_ledger_entry', {
      p_user_id: user_id,
      p_user_role: user_role,
      p_wallet_type: wallet_type,
      p_fund_category: 'bbps',
      p_service_type: 'bbps',
      p_tx_type: 'REFUND',
      p_credit: amount,
      p_debit: 0,
      p_reference_id: `BBPS_REVERSAL_${transaction_id}_${Date.now()}`,
      p_transaction_id: reversal.id,
      p_status: 'completed',
      p_remarks: `BBPS failure reversal - ${reason} - ${remarks || ''}`
    })

    if (ledgerError) {
      console.error('Error reversing transaction:', ledgerError)
      await supabase
        .from('reversals')
        .update({ status: 'failed' })
        .eq('id', reversal.id)

      return NextResponse.json(
        { error: 'Failed to reverse transaction' },
        { status: 500 }
      )
    }

    // Get after balance
    const { data: afterBalance } = await supabase.rpc('get_wallet_balance_v2', {
      p_user_id: user_id,
      p_wallet_type: wallet_type
    })

    // Update reversal with ledger entry
    await supabase
      .from('reversals')
      .update({
        reversal_ledger_id: reversalLedgerId,
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', reversal.id)

    // Update BBPS transaction status
    await supabase
      .from('bbps_transactions')
      .update({ status: 'reversed' })
      .eq('id', transaction_id)

    // Log admin action
    const { error: auditError } = await supabase
      .from('admin_audit_log')
      .insert({
        admin_id: admin.id,
        action_type: 'bbps_failure_reversal',
        target_user_id: user_id,
        target_user_role: user_role,
        wallet_type: wallet_type,
        amount: amount,
        before_balance: beforeBalance || 0,
        after_balance: afterBalance || 0,
        ip_address: ipAddress,
        user_agent: request.headers.get('user-agent') || 'unknown',
        remarks: `BBPS failure reversal - Reason: ${reason}`,
        metadata: {
          transaction_id: transaction_id,
          transaction_type: 'bbps',
          reversal_id: reversal.id
        }
      })

    if (auditError) {
      console.error('Error logging admin action:', auditError)
    }

    return NextResponse.json({
      success: true,
      message: 'BBPS transaction reversed successfully',
      reversal_id: reversal.id,
      before_balance: beforeBalance || 0,
      after_balance: afterBalance || 0,
      amount: amount
    })
  } catch (error: any) {
    console.error('Error reversing BBPS transaction:', error)
    return NextResponse.json(
      { error: 'Failed to reverse BBPS transaction' },
      { status: 500 }
    )
  }
}

