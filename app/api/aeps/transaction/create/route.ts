import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { addCorsHeaders } from '@/lib/cors'
import { checkAllLimits } from '@/lib/limits/enforcement'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

export const runtime = 'nodejs' // Force Node.js runtime (Supabase not compatible with Edge Runtime)
export const dynamic = 'force-dynamic'

function generateIdempotencyKey(prefix: string): string {
  const timestamp = Date.now()
  const random = crypto.randomUUID ? crypto.randomUUID() : `${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`
  return `${prefix}_${timestamp}_${random}`
}

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
    
    // Get current user with fallback
    const { user, method } = await getCurrentUserWithFallback(request)
    console.log('[AEPS Transaction] Auth:', method, '|', user?.email || 'none')
    
    if (!user || !user.partner_id) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }

    // Only retailers, distributors, and master distributors can perform AEPS transactions
    if (!['retailer', 'distributor', 'master_distributor'].includes(user.role)) {
      return NextResponse.json(
        { error: 'Forbidden: Invalid user role' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const {
      transaction_type,
      amount,
      aadhaar_number_masked,
      bank_iin,
      rrn,
      stan
    } = body

    // Validation
    if (!transaction_type) {
      return NextResponse.json(
        { error: 'transaction_type is required' },
        { status: 400 }
      )
    }

    if (!['balance_inquiry', 'cash_withdrawal', 'aadhaar_to_aadhaar', 'mini_statement'].includes(transaction_type)) {
      return NextResponse.json(
        { error: 'Invalid transaction_type' },
        { status: 400 }
      )
    }

    const isFinancial = ['cash_withdrawal', 'aadhaar_to_aadhaar'].includes(transaction_type)

    // For financial transactions, amount is required
    if (isFinancial && (!amount || parseFloat(amount) <= 0)) {
      return NextResponse.json(
        { error: 'amount is required for financial transactions' },
        { status: 400 }
      )
    }

    const amountDecimal = isFinancial ? parseFloat(amount) : 0

    // Check if AEPS is enabled for user (admin can disable)
    // TODO: Add AEPS enable/disable check from user settings

    // Check wallet if financial transaction
    if (isFinancial) {
      // Check if AEPS wallet is frozen
      const { data: wallet } = await supabase
        .from('wallets')
        .select('is_frozen, balance')
        .eq('user_id', user.partner_id)
        .eq('wallet_type', 'aeps')
        .single()

      if (wallet?.is_frozen) {
        return NextResponse.json(
          { error: 'AEPS wallet is frozen. Cannot process transaction.' },
          { status: 403 }
        )
      }

      // Check limits
      const limitCheck = await checkAllLimits(
        user.partner_id,
        user.role,
        'aeps',
        amountDecimal,
        'aeps'
      )

      if (!limitCheck.allowed) {
        return NextResponse.json(
          { error: limitCheck.reason || 'Transaction limit exceeded' },
          { status: 403 }
        )
      }

      // Check balance
      const { data: balance } = await supabase.rpc('get_wallet_balance_v2', {
        p_user_id: user.partner_id,
        p_wallet_type: 'aeps'
      })

      if (transaction_type === 'cash_withdrawal' && (balance || 0) < amountDecimal) {
        return NextResponse.json(
          {
            error: 'Insufficient AEPS wallet balance',
            available_balance: balance || 0,
            required_amount: amountDecimal
          },
          { status: 400 }
        )
      }
    }

    // Generate idempotency key
    const idempotencyKey = generateIdempotencyKey(`AEPS_${user.partner_id}`)

    // Create AEPS transaction record
    const { data: aepsTransaction, error: txError } = await supabase
      .from('aeps_transactions')
      .insert({
        user_id: user.partner_id,
        user_role: user.role,
        transaction_type: transaction_type,
        is_financial: isFinancial,
        amount: isFinancial ? amountDecimal : null,
        aadhaar_number_masked: aadhaar_number_masked,
        bank_iin: bank_iin,
        rrn: rrn,
        stan: stan,
        status: 'pending',
        idempotency_key: idempotencyKey
      })
      .select()
      .single()

    if (txError || !aepsTransaction) {
      console.error('Error creating AEPS transaction:', txError)
      return NextResponse.json(
        { error: 'Failed to create transaction record' },
        { status: 500 }
      )
    }

    // For financial transactions, debit AEPS wallet
    let ledgerId: string | null = null
    if (isFinancial && transaction_type === 'cash_withdrawal') {
      const { data: debitLedgerId, error: debitError } = await supabase.rpc('add_ledger_entry', {
        p_user_id: user.partner_id,
        p_user_role: user.role,
        p_wallet_type: 'aeps',
        p_fund_category: 'aeps',
        p_service_type: 'aeps',
        p_tx_type: 'AEPS_DEBIT',
        p_credit: 0,
        p_debit: amountDecimal,
        p_reference_id: idempotencyKey,
        p_transaction_id: aepsTransaction.id,
        p_status: 'pending',
        p_remarks: `AEPS ${transaction_type} - Amount: ₹${amountDecimal}`
      })

      if (debitError) {
        console.error('Error debiting AEPS wallet:', debitError)
        // Update transaction status to failed
        await supabase
          .from('aeps_transactions')
          .update({
            status: 'failed',
            error_message: 'Failed to debit AEPS wallet'
          })
          .eq('id', aepsTransaction.id)

        return NextResponse.json(
          { error: 'Failed to debit AEPS wallet' },
          { status: 500 }
        )
      }

      ledgerId = debitLedgerId

      // Update transaction with wallet debit info
      await supabase
        .from('aeps_transactions')
        .update({
          wallet_debited: true,
          wallet_debit_id: ledgerId
        })
        .eq('id', aepsTransaction.id)
    }

    // TODO: Call actual AEPS API here
    // For now, simulate success
    const aepsSuccess = true // Replace with actual AEPS API call

    if (aepsSuccess) {
      // Update transaction status
      await supabase
        .from('aeps_transactions')
        .update({
          status: 'success',
          completed_at: new Date().toISOString()
        })
        .eq('id', aepsTransaction.id)

      // Update ledger status if financial
      if (ledgerId) {
        await supabase
          .from('wallet_ledger')
          .update({ status: 'completed' })
          .eq('id', ledgerId)
      }
    } else {
      // AEPS API failed - reverse if financial
      await supabase
        .from('aeps_transactions')
        .update({
          status: 'failed',
          error_message: 'AEPS API failed'
        })
        .eq('id', aepsTransaction.id)

      if (ledgerId && isFinancial) {
        // Reverse the debit
        await supabase.rpc('add_ledger_entry', {
          p_user_id: user.partner_id,
          p_user_role: user.role,
          p_wallet_type: 'aeps',
          p_fund_category: 'aeps',
          p_service_type: 'aeps',
          p_tx_type: 'AEPS_REFUND',
          p_credit: amountDecimal,
          p_debit: 0,
          p_reference_id: `REVERSAL_${idempotencyKey}`,
          p_transaction_id: aepsTransaction.id,
          p_status: 'completed',
          p_remarks: `AEPS transaction failed - Reversal`
        })
      }
    }

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, {
      activity_type: 'aeps_transaction',
      activity_category: 'aeps',
      activity_description: `AEPS ${transaction_type || 'transaction'} for ₹${amountDecimal || 0}`,
      reference_id: aepsTransaction.id,
      reference_table: 'aeps_transactions',
      metadata: { transaction_type: transaction_type, amount: amountDecimal },
    }).catch(() => {})

    return NextResponse.json({
      success: aepsSuccess,
      transaction_id: aepsTransaction.id,
      status: aepsSuccess ? 'success' : 'failed',
      idempotency_key: idempotencyKey
    })
  } catch (error: any) {
    console.error('Error creating AEPS transaction:', error)
    return NextResponse.json(
      { error: 'Failed to create AEPS transaction' },
      { status: 500 }
    )
  }
}

