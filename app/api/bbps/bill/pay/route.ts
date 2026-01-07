import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { payRequest, generateAgentTransactionId } from '@/services/bbps'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    // Get current user (server-side)
    const user = await getCurrentUserServer()
    if (!user || !user.partner_id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Only retailers can pay bills
    if (user.role !== 'retailer') {
      return NextResponse.json(
        { error: 'Forbidden: Only retailers can access this endpoint' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { biller_id, consumer_number, amount, biller_name, consumer_name, due_date, bill_date, bill_number, additional_info } = body

    if (!biller_id || !consumer_number || !amount) {
      return NextResponse.json(
        { error: 'biller_id, consumer_number, and amount are required' },
        { status: 400 }
      )
    }

    // Validate amount
    const billAmount = parseFloat(amount)
    if (isNaN(billAmount) || billAmount <= 0) {
      return NextResponse.json(
        { error: 'Invalid amount' },
        { status: 400 }
      )
    }

    // Check wallet balance
    const { data: balanceData, error: balanceError } = await supabase.rpc('get_wallet_balance', {
      p_retailer_id: user.partner_id
    })

    if (balanceError) {
      console.error('Error checking wallet balance:', balanceError)
      return NextResponse.json(
        { error: 'Failed to check wallet balance' },
        { status: 500 }
      )
    }

    const walletBalance = balanceData || 0
    if (walletBalance < billAmount) {
      return NextResponse.json(
        { 
          error: 'Insufficient wallet balance',
          wallet_balance: walletBalance,
          required_amount: billAmount,
        },
        { status: 400 }
      )
    }

    // Generate agent transaction ID
    const agentTransactionId = generateAgentTransactionId(user.partner_id)

    // Create BBPS transaction record
    const { data: bbpsTransaction, error: txError } = await supabase
      .from('bbps_transactions')
      .insert({
        retailer_id: user.partner_id,
        biller_id,
        biller_name,
        consumer_number,
        consumer_name,
        bill_amount: billAmount,
        amount_paid: billAmount,
        agent_transaction_id: agentTransactionId,
        status: 'pending',
        due_date: due_date || null,
        bill_date: bill_date || null,
        bill_number: bill_number || null,
        additional_info: additional_info || {},
      })
      .select()
      .single()

    if (txError || !bbpsTransaction) {
      console.error('Error creating BBPS transaction:', txError)
      return NextResponse.json(
        { error: 'Failed to create transaction record' },
        { status: 500 }
      )
    }

    // Debit wallet first (before making payment)
    try {
      const { data: debitId, error: debitError } = await supabase.rpc('debit_wallet_bbps', {
        p_retailer_id: user.partner_id,
        p_transaction_id: bbpsTransaction.id,
        p_amount: billAmount,
        p_description: `BBPS Payment - ${biller_name || biller_id} - Consumer: ${consumer_number}`,
        p_reference_id: agentTransactionId,
      })

      if (debitError) {
        console.error('Error debiting wallet:', debitError)
        // Update transaction status to failed
        await supabase
          .from('bbps_transactions')
          .update({ 
            status: 'failed',
            error_message: 'Failed to debit wallet',
          })
          .eq('id', bbpsTransaction.id)

        return NextResponse.json(
          { error: 'Failed to debit wallet: ' + debitError.message },
          { status: 500 }
        )
      }
    } catch (debitError: any) {
      console.error('Error debiting wallet:', debitError)
      // Update transaction status to failed
      await supabase
        .from('bbps_transactions')
        .update({ 
          status: 'failed',
          error_message: debitError.message || 'Failed to debit wallet',
        })
        .eq('id', bbpsTransaction.id)

      return NextResponse.json(
        { error: debitError.message || 'Failed to debit wallet' },
        { status: 500 }
      )
    }

    // Prepare additional_info with billerResponse for payRequest API
    const paymentAdditionalInfo = {
      ...(additional_info || {}),
      billerResponse: {
        responseCode: '000',
        responseMessage: 'Bill fetched successfully',
        billAmount: billAmount.toString(),
        dueDate: due_date,
        billDate: bill_date,
        billNumber: bill_number,
        customerName: consumer_name,
      },
    }

    // Prepare inputParams
    const inputParams = additional_info?.inputParams || [
      {
        paramName: 'Consumer Number',
        paramValue: consumer_number,
      }
    ]

    // Make payment to BBPS API using new service
    const paymentResponse = await payRequest({
      billerId: biller_id,
      consumerNumber: consumer_number,
      amount: billAmount,
      agentTransactionId: agentTransactionId,
      inputParams,
      additionalInfo: paymentAdditionalInfo,
      billerResponse: paymentAdditionalInfo.billerResponse,
    })

    // Update transaction with payment response
    const updateData: any = {
      payment_status: paymentResponse.payment_status || paymentResponse.status,
      updated_at: new Date().toISOString(),
    }

    if (paymentResponse.success && paymentResponse.transaction_id) {
      updateData.transaction_id = paymentResponse.transaction_id
      updateData.status = 'success'
      updateData.completed_at = new Date().toISOString()
    } else {
      updateData.status = 'failed'
      updateData.error_code = paymentResponse.error_code
      updateData.error_message = paymentResponse.error_message
      
      // If payment failed, refund the wallet
      if (paymentResponse.success === false) {
        try {
          await supabase.rpc('refund_wallet_bbps', {
            p_retailer_id: user.partner_id,
            p_transaction_id: bbpsTransaction.id,
            p_amount: billAmount,
            p_description: `BBPS Payment Refund - ${paymentResponse.error_message || 'Payment failed'}`,
            p_reference_id: agentTransactionId,
          })
        } catch (refundError) {
          console.error('Error refunding wallet:', refundError)
          // Log error but don't fail the response
        }
      }
    }

    await supabase
      .from('bbps_transactions')
      .update(updateData)
      .eq('id', bbpsTransaction.id)

    return NextResponse.json({
      success: paymentResponse.success,
      transaction_id: bbpsTransaction.id,
      agent_transaction_id: agentTransactionId,
      bbps_transaction_id: paymentResponse.transaction_id,
      status: updateData.status,
      payment_status: updateData.payment_status,
      error_code: paymentResponse.error_code,
      error_message: paymentResponse.error_message,
      wallet_balance: walletBalance - billAmount,
    })
  } catch (error: any) {
    console.error('Error paying bill:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to pay bill' },
      { status: 500 }
    )
  }
}

