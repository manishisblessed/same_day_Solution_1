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
      transaction_id,
      transaction_type,
      reason,
      remarks
    } = body

    // Validation
    if (!transaction_id || !transaction_type || !reason) {
      return NextResponse.json(
        { error: 'transaction_id, transaction_type, and reason are required' },
        { status: 400 }
      )
    }

    if (!['bbps', 'aeps', 'settlement', 'admin', 'pos'].includes(transaction_type)) {
      return NextResponse.json(
        { error: 'Invalid transaction_type' },
        { status: 400 }
      )
    }

    // Get IP address
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown'

    // Get original transaction based on type
    let originalTransaction: any = null
    let user_id: string = ''
    let user_role: string = ''
    let amount: number = 0
    let wallet_type: 'primary' | 'aeps' = 'primary'
    let original_ledger_id: string | null = null

    if (transaction_type === 'bbps') {
      const { data: tx } = await supabase
        .from('bbps_transactions')
        .select('id, retailer_id, bill_amount, wallet_debit_id, status')
        .eq('id', transaction_id)
        .single()

      if (!tx) {
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

      originalTransaction = tx
      user_id = tx.retailer_id
      user_role = 'retailer'
      amount = parseFloat(tx.bill_amount.toString())
      wallet_type = 'primary'
      original_ledger_id = tx.wallet_debit_id
    } else if (transaction_type === 'aeps') {
      const { data: tx } = await supabase
        .from('aeps_transactions')
        .select('id, user_id, user_role, amount, wallet_debit_id, status')
        .eq('id', transaction_id)
        .single()

      if (!tx) {
        return NextResponse.json(
          { error: 'AEPS transaction not found' },
          { status: 404 }
        )
      }

      if (tx.status === 'reversed') {
        return NextResponse.json(
          { error: 'Transaction already reversed' },
          { status: 400 }
        )
      }

      originalTransaction = tx
      user_id = tx.user_id
      user_role = tx.user_role
      amount = parseFloat((tx.amount || 0).toString())
      wallet_type = 'aeps'
      original_ledger_id = tx.wallet_debit_id
    } else if (transaction_type === 'settlement') {
      const { data: tx } = await supabase
        .from('settlements')
        .select('id, user_id, user_role, amount, ledger_entry_id, status')
        .eq('id', transaction_id)
        .single()

      if (!tx) {
        return NextResponse.json(
          { error: 'Settlement not found' },
          { status: 404 }
        )
      }

      if (tx.status === 'reversed') {
        return NextResponse.json(
          { error: 'Settlement already reversed' },
          { status: 400 }
        )
      }

      originalTransaction = tx
      user_id = tx.user_id
      user_role = tx.user_role
      amount = parseFloat(tx.amount.toString())
      wallet_type = 'primary'
      original_ledger_id = tx.ledger_entry_id
    } else {
      return NextResponse.json(
        { error: 'Unsupported transaction type for reversal' },
        { status: 400 }
      )
    }

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
        transaction_type: transaction_type,
        user_id: user_id,
        user_role: user_role,
        original_amount: amount,
        reversal_amount: amount,
        reason: reason,
        status: 'processing',
        original_ledger_id: original_ledger_id,
        admin_id: admin.id,
        ip_address: ipAddress,
        remarks: remarks || `Reversal by admin - ${reason}`
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
      p_fund_category: transaction_type === 'bbps' ? 'bbps' : transaction_type === 'aeps' ? 'aeps' : 'settlement',
      p_service_type: transaction_type,
      p_tx_type: 'REFUND',
      p_credit: amount,
      p_debit: 0,
      p_reference_id: `REVERSAL_${transaction_id}_${Date.now()}`,
      p_transaction_id: reversal.id,
      p_status: 'completed',
      p_remarks: `Reversal - ${reason} - ${remarks || ''}`
    })

    if (ledgerError) {
      console.error('Error reversing transaction:', ledgerError)
      // Update reversal status to failed
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

    // Update original transaction status
    if (transaction_type === 'bbps') {
      await supabase
        .from('bbps_transactions')
        .update({ status: 'reversed' })
        .eq('id', transaction_id)
    } else if (transaction_type === 'aeps') {
      await supabase
        .from('aeps_transactions')
        .update({ status: 'reversed' })
        .eq('id', transaction_id)
    } else if (transaction_type === 'settlement') {
      await supabase
        .from('settlements')
        .update({ status: 'reversed' })
        .eq('id', transaction_id)
    }

    // Log admin action
    const { error: auditError } = await supabase
      .from('admin_audit_log')
      .insert({
        admin_id: admin.id,
        action_type: 'transaction_reverse',
        target_user_id: user_id,
        target_user_role: user_role,
        wallet_type: wallet_type,
        amount: amount,
        before_balance: beforeBalance || 0,
        after_balance: afterBalance || 0,
        ip_address: ipAddress,
        user_agent: request.headers.get('user-agent') || 'unknown',
        remarks: `Transaction reversal - Type: ${transaction_type}, Reason: ${reason}`,
        metadata: {
          transaction_id: transaction_id,
          transaction_type: transaction_type,
          reversal_id: reversal.id
        }
      })

    if (auditError) {
      console.error('Error logging admin action:', auditError)
      // Don't fail the request if audit logging fails
    }

    return NextResponse.json({
      success: true,
      message: 'Transaction reversed successfully',
      reversal_id: reversal.id,
      before_balance: beforeBalance || 0,
      after_balance: afterBalance || 0,
      amount: amount
    })
  } catch (error: any) {
    console.error('Error creating reversal:', error)
    return NextResponse.json(
      { error: 'Failed to create reversal' },
      { status: 500 }
    )
  }
}

