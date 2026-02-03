import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getTransferStatus } from '@/services/payout'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Create Supabase admin client
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * GET /api/payout/status
 * 
 * Checks the status of a payout transfer, or lists all transactions.
 * 
 * Query Parameters:
 * - transactionId: Our internal transaction ID
 * - clientRefId: Client reference ID
 * - list: Set to "true" to get list of recent transactions
 * - user_id: Fallback auth - retailer partner_id
 */
export async function GET(request: NextRequest) {
  try {
    // Parse query parameters
    const { searchParams } = new URL(request.url)
    const transactionId = searchParams.get('transactionId')
    const clientRefId = searchParams.get('clientRefId')
    const listMode = searchParams.get('list') === 'true'
    const userId = searchParams.get('user_id')
    
    // Get current user
    let user = await getCurrentUserFromRequest(request)
    
    // Fallback auth using user_id
    if ((!user || !user.partner_id) && userId) {
      const { data: retailer } = await supabaseAdmin
        .from('retailers')
        .select('partner_id, name, email')
        .eq('partner_id', userId)
        .maybeSingle()
      
      if (retailer) {
        user = {
          id: userId,
          email: retailer.email,
          role: 'retailer',
          partner_id: retailer.partner_id,
          name: retailer.name,
        }
      }
    }
    
    if (!user || !user.partner_id) {
      const response = NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      )
      return addCorsHeaders(request, response)
    }

    // If list mode, return recent transactions
    if (listMode) {
      const { data: transactions, error: listError } = await supabaseAdmin
        .from('payout_transactions')
        .select('*')
        .eq('retailer_id', user.partner_id)
        .order('created_at', { ascending: false })
        .limit(20)
      
      if (listError) {
        console.error('[Payout Status] List error:', listError)
        const response = NextResponse.json({
          success: true,
          transactions: [],
        })
        return addCorsHeaders(request, response)
      }
      
      const response = NextResponse.json({
        success: true,
        transactions: transactions || [],
      })
      return addCorsHeaders(request, response)
    }

    if (!transactionId && !clientRefId) {
      const response = NextResponse.json(
        { success: false, error: 'Transaction ID or client reference ID is required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Fetch transaction from database
    let query = supabaseAdmin
      .from('payout_transactions')
      .select('*')
    
    if (transactionId) {
      query = query.eq('id', transactionId)
    } else if (clientRefId) {
      query = query.eq('client_ref_id', clientRefId)
    }

    // For retailers, only show their own transactions
    if (user.role === 'retailer') {
      query = query.eq('retailer_id', user.partner_id)
    }

    const { data: transaction, error: txError } = await query.single()

    if (txError || !transaction) {
      const response = NextResponse.json(
        { success: false, error: 'Transaction not found' },
        { status: 404 }
      )
      return addCorsHeaders(request, response)
    }

    // If transaction is still pending/processing, check with provider
    if (['pending', 'processing'].includes(transaction.status) && transaction.transaction_id) {
      const statusResult = await getTransferStatus({
        transactionId: transaction.transaction_id,
      })

      if (statusResult.success && statusResult.status) {
        const newStatus = statusResult.status
        
        // Update transaction if status changed
        if (newStatus !== transaction.status) {
          const updateData: any = {
            status: newStatus,
            updated_at: new Date().toISOString(),
          }
          
          if (statusResult.operator_id) updateData.rrn = statusResult.operator_id // opid is the RRN
          if (statusResult.status === 'failed') updateData.failure_reason = statusResult.status_message || 'Transaction failed'
          if (newStatus === 'success' || newStatus === 'failed') {
            updateData.completed_at = new Date().toISOString()
          }

          await supabaseAdmin
            .from('payout_transactions')
            .update(updateData)
            .eq('id', transaction.id)

          // If failed, process refund
          if (newStatus === 'failed' && transaction.wallet_debited) {
            const totalAmount = transaction.amount + transaction.charges
            await supabaseAdmin.rpc('add_ledger_entry', {
              p_user_id: transaction.retailer_id,
              p_user_role: 'retailer',
              p_wallet_type: 'primary',
              p_fund_category: 'payout',
              p_service_type: 'payout',
              p_tx_type: 'REFUND',
              p_credit: totalAmount,
              p_debit: 0,
              p_reference_id: `REFUND_${transaction.client_ref_id}`,
              p_transaction_id: transaction.id,
              p_status: 'completed',
              p_remarks: `Payout failed - Auto refund: ${statusResult.status_message || 'Unknown reason'}`
            })

            // Mark transaction as refunded
            await supabaseAdmin
              .from('payout_transactions')
              .update({ status: 'refunded' })
              .eq('id', transaction.id)
          }

          // Return updated status
          transaction.status = newStatus
          transaction.rrn = statusResult.operator_id || transaction.rrn
          transaction.failure_reason = statusResult.status_message || transaction.failure_reason
        }
      }
    }

    const response = NextResponse.json({
      success: true,
      transaction: {
        id: transaction.id,
        client_ref_id: transaction.client_ref_id,
        provider_txn_id: transaction.transaction_id,
        rrn: transaction.rrn,
        status: transaction.status.toUpperCase(),
        amount: transaction.amount,
        charges: transaction.charges,
        total_amount: transaction.amount + transaction.charges,
        account_number: transaction.account_number.replace(/\d(?=\d{4})/g, '*'),
        account_holder_name: transaction.account_holder_name,
        bank_name: transaction.bank_name,
        transfer_mode: transaction.transfer_mode,
        failure_reason: transaction.failure_reason,
        remarks: transaction.remarks,
        created_at: transaction.created_at,
        completed_at: transaction.completed_at,
      },
    })
    
    return addCorsHeaders(request, response)

  } catch (error: any) {
    console.error('[Payout Status] Error:', error)
    const response = NextResponse.json(
      { 
        success: false, 
        error: error.message || 'Failed to fetch status',
      },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

