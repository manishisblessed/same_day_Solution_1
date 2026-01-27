import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { createClient } from '@supabase/supabase-js'
import { payRequest, generateAgentTransactionId, getBBPSWalletBalance } from '@/services/bbps'
import { paiseToRupees } from '@/lib/bbps/currency'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'

export const runtime = 'nodejs' // Force Node.js runtime (Supabase not compatible with Edge Runtime)
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function POST(request: NextRequest) {
  try {
    // Initialize Supabase client at runtime (not during build)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    
    if (!supabaseUrl) {
      const response = NextResponse.json(
        { error: 'Supabase configuration missing' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    
    const body = await request.json()
    
    // Try cookie-based auth first
    let user = await getCurrentUserFromRequest(request)
    
    // If cookie auth fails, try to verify user from request body (fallback)
    // This is needed because Supabase cookie-based auth may not work reliably
    if ((!user || !user.partner_id) && body.user_id) {
      // Verify the user_id exists in retailers table
      const { data: retailer } = await supabase
        .from('retailers')
        .select('partner_id, name, email')
        .eq('partner_id', body.user_id)
        .maybeSingle()
      
      if (retailer) {
        user = {
          id: body.user_id,
          email: retailer.email,
          role: 'retailer',
          partner_id: retailer.partner_id,
          name: retailer.name,
        }
        console.log('BBPS Pay: Using fallback auth with user_id from request body:', user.email)
      }
    }
    
    if (!user || !user.partner_id) {
      console.error('BBPS Bill Pay: No authenticated user found')
      const response = NextResponse.json(
        { error: 'Unauthorized', message: 'Please log in to pay bills' },
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
    const { biller_id, consumer_number, amount, biller_name, consumer_name, due_date, bill_date, bill_number, additional_info, biller_category, tpin } = body

    if (!biller_id || !consumer_number || !amount) {
      const response = NextResponse.json(
        { error: 'biller_id, consumer_number, and amount are required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Verify T-PIN if provided (optional security feature)
    if (tpin) {
      try {
        const { data: tpinResult, error: tpinError } = await (supabase as any).rpc('verify_retailer_tpin', {
          p_retailer_id: user.partner_id,
          p_tpin: tpin
        })

        if (tpinError) {
          console.log('T-PIN verification function not available, proceeding without verification:', tpinError.message)
          // T-PIN feature not set up yet, allow transaction to proceed
        } else if (tpinResult && !tpinResult.success) {
          // T-PIN verification failed
          console.log('T-PIN verification failed:', tpinResult)
          return NextResponse.json(
            { 
              error: tpinResult.error || 'Invalid T-PIN',
              tpin_error: true,
              attempts_remaining: tpinResult.attempts_remaining,
              locked_until: tpinResult.locked_until
            },
            { status: 401 }
          )
        } else if (tpinResult && tpinResult.success) {
          console.log('T-PIN verified successfully for retailer:', user.partner_id)
        }
      } catch (tpinVerifyError: any) {
        console.log('T-PIN verification error (feature may not be set up):', tpinVerifyError.message)
        // Continue without T-PIN verification if the feature is not available
      }
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

    // Convert paise to rupees for balance checks
    const billAmountInRupees = paiseToRupees(billAmountInPaise)

    // ========================================
    // STEP 1: Check SparkUpTech BBPS Provider Balance
    // ========================================
    // SparkUpTech wallet is our master BBPS wallet - it pays the actual bill amount
    // We check this FIRST to ensure we can fulfill the payment
    console.log('Checking SparkUpTech BBPS provider balance...')
    const bbpsProviderBalance = await getBBPSWalletBalance()
    
    if (!bbpsProviderBalance.success) {
      console.error('Failed to check BBPS provider balance:', bbpsProviderBalance.error)
      const response = NextResponse.json(
        { 
          error: 'BBPS service temporarily unavailable. Please try again later.',
          error_code: 'BBPS_PROVIDER_UNAVAILABLE',
        },
        { status: 503 }
      )
      return addCorsHeaders(request, response)
    }
    
    const availableProviderBalance = (bbpsProviderBalance.balance || 0) - (bbpsProviderBalance.lien || 0)
    console.log(`SparkUpTech BBPS Balance: ₹${bbpsProviderBalance.balance}, Lien: ₹${bbpsProviderBalance.lien}, Available: ₹${availableProviderBalance}`)
    
    // Check if provider has enough balance for the bill amount (no charges - charges stay with us)
    if (availableProviderBalance < billAmountInRupees) {
      console.error(`BBPS Provider balance insufficient: Available ₹${availableProviderBalance}, Required ₹${billAmountInRupees}`)
      const response = NextResponse.json(
        { 
          error: 'BBPS service temporarily unavailable due to low provider balance. Please contact admin.',
          error_code: 'BBPS_PROVIDER_LOW_BALANCE',
        },
        { status: 503 }
      )
      return addCorsHeaders(request, response)
    }

    // ========================================
    // STEP 2: Check Retailer's Local Wallet Balance
    // ========================================
    // Retailer pays: Bill Amount + Transaction Charges
    // Check retailer wallet balance
    const { data: balanceData, error: balanceError } = await (supabase as any).rpc('get_wallet_balance', {
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
    // billAmountInRupees already calculated above
    
    // Calculate BBPS charge based on amount slabs
    const { data: chargeData, error: chargeError } = await (supabase as any).rpc('calculate_transaction_charge', {
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

    // ========================================
    // STEP 3: Debit Retailer's Local Wallet
    // ========================================
    // Retailer pays: Bill Amount + Transaction Charges
    // The charge stays with us as profit
    try {
      const { data: debitId, error: debitError } = await (supabase as any).rpc('debit_wallet_bbps', {
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
      
      // FIX: If payment failed, refund the FULL amount (bill + charge)
      // Wallet uses rupees, so use totalAmountNeeded (includes charge)
      if (paymentResponse.success === false) {
        try {
          await (supabase as any).rpc('refund_wallet_bbps', {
            p_retailer_id: user.partner_id,
            p_transaction_id: bbpsTransaction.id,
            p_amount: totalAmountNeeded, // FIX: Refund full amount including charge
            p_description: `BBPS Payment Refund - ${paymentResponse.error_message || 'Payment failed'} (Bill: ₹${billAmountInRupees}, Charge: ₹${bbpsCharge})`,
            p_reference_id: `REFUND_${agentTransactionId}`,
          })
        } catch (refundError) {
          console.error('Error refunding wallet:', refundError)
          // Log error but don't fail the response - flag for admin review
          updateData.error_message = (updateData.error_message || '') + ' [REFUND_FAILED: Manual review required]'
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

