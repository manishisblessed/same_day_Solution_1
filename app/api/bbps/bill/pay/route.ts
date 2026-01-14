import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { payRequest, generateAgentTransactionId } from '@/services/bbps'
import { paiseToRupees } from '@/lib/bbps/currency'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function POST(request: NextRequest) {
  try {
    // Get current user (server-side)
    const user = await getCurrentUserServer()
    if (!user || !user.partner_id) {
      const response = NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
      return addCorsHeaders(request, response)
    }

    // Only retailers can pay bills
    if (user.role !== 'retailer') {
      const response = NextResponse.json(
        { error: 'Forbidden: Only retailers can access this endpoint' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const body = await request.json()
    const { biller_id, consumer_number, amount, biller_name, consumer_name, due_date, bill_date, bill_number, additional_info, biller_category } = body

    if (!biller_id || !consumer_number || !amount) {
      const response = NextResponse.json(
        { error: 'biller_id, consumer_number, and amount are required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Validate amount
    // IMPORTANT: Amount from frontend is in paise (as returned by BBPS Fetch Bill API)
    const billAmountInPaise = parseFloat(amount)
    if (isNaN(billAmountInPaise) || billAmountInPaise <= 0) {
      const response = NextResponse.json(
        { error: 'Invalid amount' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
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
    // Convert paise to rupees for comparison (wallet balance is in rupees)
    const billAmountInRupees = paiseToRupees(billAmountInPaise)
    
    // Calculate BBPS charge based on amount slabs
    const { data: chargeData, error: chargeError } = await supabase.rpc('calculate_transaction_charge', {
      p_amount: billAmountInRupees,
      p_transaction_type: 'bbps'
    })
    const bbpsCharge = chargeData || 20 // Default to ₹20 if calculation fails
    
    // Total amount needed (bill + charge)
    const totalAmountNeeded = billAmountInRupees + bbpsCharge
    
    if (walletBalance < totalAmountNeeded) {
      return NextResponse.json(
        { 
          error: 'Insufficient wallet balance',
          wallet_balance: walletBalance,
          bill_amount: billAmountInRupees,
          charge: bbpsCharge,
          required_amount: totalAmountNeeded,
        },
        { status: 400 }
      )
    }

    // Generate agent transaction ID
    const agentTransactionId = generateAgentTransactionId(user.partner_id)

    // Create BBPS transaction record
    // Store amount in rupees in database (for consistency with wallet which is in rupees)
    const { data: bbpsTransaction, error: txError } = await supabase
      .from('bbps_transactions')
      .insert({
        retailer_id: user.partner_id,
        biller_id,
        biller_name,
        consumer_number,
        consumer_name,
        bill_amount: billAmountInRupees, // Store in rupees in database
        amount_paid: billAmountInRupees, // Store in rupees in database
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

    // Debit wallet first (before making payment) - includes charge
    // Wallet operations use rupees, so convert from paise
    try {
      const { data: debitId, error: debitError } = await supabase.rpc('debit_wallet_bbps', {
        p_retailer_id: user.partner_id,
        p_transaction_id: bbpsTransaction.id,
        p_amount: totalAmountNeeded, // Wallet uses rupees - includes bill amount + charge
        p_description: `BBPS Payment - ${biller_name || biller_id} - Consumer: ${consumer_number} (Charge: ₹${bbpsCharge})`,
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
    // IMPORTANT: Pay Request API expects amount in paise - do NOT convert
    const paymentAdditionalInfo = {
      ...(additional_info || {}),
      billerResponse: {
        responseCode: '000',
        responseMessage: 'Bill fetched successfully',
        billAmount: billAmountInPaise.toString(), // Keep in paise for API
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

    // Extract billerAdhoc from metadata (from biller info or additional_info)
    // billerAdhoc should be "true" (string) for adhoc billers, "false" otherwise
    const billerAdhoc = additional_info?.metadata?.billerAdhoc || 
                        additional_info?.billerAdhoc || 
                        'false' // Default to false if not found
    
    // Convert to string format expected by API ("true" or "false")
    const billerAdhocString = String(billerAdhoc).toLowerCase() === 'true' ? 'true' : 'false'

    // Extract sub_service_name from biller category
    // Use the category from request body, or try to extract from additional_info
    const subServiceName = biller_category || 
                          additional_info?.metadata?.billerCategory || 
                          additional_info?.category || 
                          'BBPS Bill payment' // Default fallback

    // Extract paymentInfo from additional_info if available
    const paymentInfo = additional_info?.paymentInfo || [
      {
        infoName: 'Remarks',
        infoValue: 'Received'
      }
    ]

    // Make payment to BBPS API using new service
    // IMPORTANT: Pay Request API expects amount in paise - send billAmountInPaise (not converted)
    const paymentResponse = await payRequest({
      billerId: biller_id,
      consumerNumber: consumer_number,
      amount: billAmountInPaise, // Send in paise to BBPS API
      agentTransactionId: agentTransactionId,
      inputParams,
      subServiceName, // Use extracted category (e.g., "Credit Card")
      billerAdhoc: billerAdhocString, // Use extracted billerAdhoc ("true" or "false")
      paymentInfo, // Use extracted paymentInfo
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
      // Wallet uses rupees, so use billAmountInRupees
      if (paymentResponse.success === false) {
        try {
          await supabase.rpc('refund_wallet_bbps', {
            p_retailer_id: user.partner_id,
            p_transaction_id: bbpsTransaction.id,
            p_amount: billAmountInRupees, // Wallet uses rupees
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

    const response = NextResponse.json({
      success: paymentResponse.success,
      transaction_id: bbpsTransaction.id,
      agent_transaction_id: agentTransactionId,
      bbps_transaction_id: paymentResponse.transaction_id,
      status: updateData.status,
      payment_status: updateData.payment_status,
      error_code: paymentResponse.error_code,
      error_message: paymentResponse.error_message,
      wallet_balance: walletBalance - billAmountInRupees, // Wallet uses rupees
    })
    
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('Error paying bill:', error)
    const response = NextResponse.json(
      { error: 'Failed to pay bill' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

