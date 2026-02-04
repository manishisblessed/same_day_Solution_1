import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { initiateTransfer, generateClientRefId, getPayoutBalance } from '@/services/payout'
import { getPayoutCharges, getTransferLimits } from '@/services/payout/config'
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
 * POST /api/payout/transfer
 * 
 * Initiates a bank transfer via IMPS/NEFT.
 * Debits the retailer's wallet and transfers to the specified bank account.
 * 
 * Request Body:
 * - accountNumber: Bank account number
 * - ifscCode: IFSC code
 * - accountHolderName: Beneficiary name
 * - amount: Amount to transfer (in rupees)
 * - transferMode: 'IMPS' or 'NEFT'
 * - bankId: Bank ID from bank list
 * - bankName: Bank name
 * - beneficiaryMobile: Beneficiary mobile number
 * - senderName: Sender name
 * - senderMobile: Sender mobile number
 * - senderEmail: Optional sender email
 * - remarks: Optional remarks
 * - tpin: Transaction PIN for authorization
 * - user_id: Fallback auth - retailer partner_id (if cookie auth fails)
 */
export async function POST(request: NextRequest) {
  try {
    // Parse request body first (needed for fallback auth)
    const body = await request.json()
    const { 
      accountNumber, 
      ifscCode, 
      accountHolderName, 
      amount, 
      transferMode, 
      bankId,
      bankName,
      beneficiaryMobile,
      senderName,
      senderMobile,
      senderEmail,
      remarks,
      tpin,
      user_id
    } = body

    // Try cookie-based auth first
    let user = await getCurrentUserFromRequest(request)
    
    // If cookie auth fails, try to verify user from request body (fallback)
    if ((!user || !user.partner_id) && user_id) {
      const { data: retailer } = await supabaseAdmin
        .from('retailers')
        .select('partner_id, name, email')
        .eq('partner_id', user_id)
        .maybeSingle()
      
      if (retailer) {
        user = {
          id: user_id,
          email: retailer.email,
          role: 'retailer',
          partner_id: retailer.partner_id,
          name: retailer.name,
        }
        console.log('[Payout Transfer] Using fallback auth with user_id:', user.email)
      }
    }
    
    if (!user || !user.partner_id) {
      console.error('[Payout Transfer] No authenticated user found')
      const response = NextResponse.json(
        { success: false, error: 'Authentication required. Please log in again.' },
        { status: 401 }
      )
      return addCorsHeaders(request, response)
    }

    // Only retailers can initiate transfers
    const userRole = user.role as string | undefined
    if (userRole !== 'retailer') {
      const response = NextResponse.json(
        { success: false, error: 'Only retailers can initiate transfers' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    // Validate required fields
    if (!accountNumber || !ifscCode || !accountHolderName || !amount || !transferMode) {
      const response = NextResponse.json(
        { success: false, error: 'All fields are required: accountNumber, ifscCode, accountHolderName, amount, transferMode' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Validate bank details
    // Note: bankId can be 0 for some banks, but bankName is always required
    if (bankId === undefined || bankId === null || !bankName) {
      console.error('[Payout Transfer] Missing bank details:', { bankId, bankName })
      const response = NextResponse.json(
        { success: false, error: 'Bank ID and bank name are required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Log transfer request for debugging
    console.log('[Payout Transfer] Request:', {
      accountNumber: accountNumber?.replace(/\d(?=\d{4})/g, '*'),
      ifscCode,
      accountHolderName,
      amount,
      transferMode,
      bankId,
      bankName,
      beneficiaryMobile,
      senderName,
      senderMobile,
    })

    // Validate beneficiary and sender details
    if (!beneficiaryMobile || !senderName || !senderMobile) {
      const response = NextResponse.json(
        { success: false, error: 'Beneficiary mobile, sender name, and sender mobile are required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Validate mobile numbers (Indian format: 10 digits starting with 6-9)
    const mobileRegex = /^[6-9]\d{9}$/
    if (!mobileRegex.test(beneficiaryMobile)) {
      const response = NextResponse.json(
        { success: false, error: 'Invalid beneficiary mobile number' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }
    if (!mobileRegex.test(senderMobile)) {
      const response = NextResponse.json(
        { success: false, error: 'Invalid sender mobile number' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Validate TPIN
    if (!tpin || tpin.length !== 4) {
      const response = NextResponse.json(
        { success: false, error: 'Valid 4-digit TPIN is required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // TODO: Verify TPIN against stored hash
    // For now, accept any 4-digit TPIN
    
    // Validate amount
    const amountNum = parseFloat(amount)
    if (isNaN(amountNum) || amountNum <= 0) {
      const response = NextResponse.json(
        { success: false, error: 'Invalid amount' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Check transfer limits
    const limits = getTransferLimits()
    if (amountNum < limits.min) {
      const response = NextResponse.json(
        { success: false, error: `Minimum transfer amount is ₹${limits.min}` },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }
    if (amountNum > limits.max) {
      const response = NextResponse.json(
        { success: false, error: `Maximum transfer amount is ₹${limits.max}` },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Validate transfer mode
    if (!['IMPS', 'NEFT'].includes(transferMode)) {
      const response = NextResponse.json(
        { success: false, error: 'Transfer mode must be IMPS or NEFT' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Calculate charges
    const chargesConfig = getPayoutCharges()
    const charges = transferMode === 'IMPS' ? chargesConfig.imps : chargesConfig.neft
    const totalAmount = amountNum + charges

    // Check retailer's wallet balance
    const { data: walletBalance, error: balanceError } = await supabaseAdmin.rpc('get_wallet_balance_v2', {
      p_user_id: user.partner_id,
      p_wallet_type: 'primary'
    })

    if (balanceError || walletBalance === null) {
      console.error('Error fetching wallet balance:', balanceError)
      const response = NextResponse.json(
        { success: false, error: 'Failed to check wallet balance' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    if (walletBalance < totalAmount) {
      const response = NextResponse.json(
        { 
          success: false, 
          error: 'Insufficient wallet balance',
          wallet_balance: walletBalance,
          amount: amountNum,
          charges,
          total_required: totalAmount,
        },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Check provider balance
    const providerBalance = await getPayoutBalance()
    if (!providerBalance.success || (providerBalance.available_balance || 0) < amountNum) {
      const response = NextResponse.json(
        { 
          success: false, 
          error: 'Payout service temporarily unavailable. Please try again later.',
        },
        { status: 503 }
      )
      return addCorsHeaders(request, response)
    }

    // Generate client reference ID
    const clientRefId = generateClientRefId(user.partner_id || 'UNKNOWN')

    // Create payout transaction record
    const { data: payoutTx, error: txError } = await supabaseAdmin
      .from('payout_transactions')
      .insert({
        retailer_id: user.partner_id,
        account_number: accountNumber,
        ifsc_code: ifscCode,
        account_holder_name: accountHolderName,
        bank_name: bankName,
        amount: amountNum,
        charges,
        transfer_mode: transferMode,
        client_ref_id: clientRefId,
        status: 'pending',
        remarks: remarks || null,
        wallet_debited: false,
      })
      .select()
      .single()

    if (txError || !payoutTx) {
      console.error('Error creating payout transaction:', txError)
      const response = NextResponse.json(
        { success: false, error: 'Failed to create transaction record' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    // Debit wallet
    // Note: fund_category must be one of: 'cash', 'online', 'commission', 'settlement', 'adjustment', 'aeps', 'bbps', 'other'
    // service_type must be one of: 'bbps', 'aeps', 'settlement', 'pos', 'admin', 'other'
    const { data: ledgerId, error: ledgerError } = await supabaseAdmin.rpc('add_ledger_entry', {
      p_user_id: user.partner_id,
      p_user_role: 'retailer',
      p_wallet_type: 'primary',
      p_fund_category: 'settlement', // Payout is part of settlement flow
      p_service_type: 'settlement', // Bank transfer = settlement
      p_tx_type: 'PAYOUT',
      p_credit: 0,
      p_debit: totalAmount,
      p_reference_id: clientRefId,
      p_transaction_id: payoutTx.id,
      p_status: 'pending',
      p_remarks: `Payout to ${accountHolderName} - ${accountNumber} via ${transferMode}`
    })

    if (ledgerError) {
      console.error('Error debiting wallet:', ledgerError)
      // Mark transaction as failed
      await supabaseAdmin
        .from('payout_transactions')
        .update({ status: 'failed', failure_reason: 'Wallet debit failed' })
        .eq('id', payoutTx.id)
      
      const response = NextResponse.json(
        { success: false, error: 'Failed to debit wallet' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    // Update transaction with wallet debit info
    await supabaseAdmin
      .from('payout_transactions')
      .update({ 
        wallet_debited: true, 
        wallet_debit_id: ledgerId,
        status: 'processing'
      })
      .eq('id', payoutTx.id)

    // Initiate transfer with SparkUp expressPay2 API
    const transferResult = await initiateTransfer({
      accountNumber,
      ifscCode,
      accountHolderName,
      amount: amountNum,
      transferMode: transferMode as 'IMPS' | 'NEFT',
      bankId: parseInt(bankId),
      bankName,
      beneficiaryMobile,
      senderName,
      senderMobile,
      senderEmail: senderEmail || user.email,
      remarks: remarks || `Payout - ${clientRefId}`,
      clientRefId,
    })

    if (!transferResult.success) {
      // Refund the wallet
      await supabaseAdmin.rpc('add_ledger_entry', {
        p_user_id: user.partner_id,
        p_user_role: 'retailer',
        p_wallet_type: 'primary',
        p_fund_category: 'settlement', // Payout refund is part of settlement flow
        p_service_type: 'settlement',
        p_tx_type: 'REFUND',
        p_credit: totalAmount,
        p_debit: 0,
        p_reference_id: `REFUND_${clientRefId}`,
        p_transaction_id: payoutTx.id,
        p_status: 'completed',
        p_remarks: `Payout failed - Refund: ${transferResult.error}`
      })

      // Update transaction as failed
      await supabaseAdmin
        .from('payout_transactions')
        .update({ 
          status: 'failed', 
          failure_reason: transferResult.error,
          updated_at: new Date().toISOString()
        })
        .eq('id', payoutTx.id)

      // Update original ledger entry status
      await supabaseAdmin
        .from('wallet_ledger')
        .update({ status: 'failed' })
        .eq('id', ledgerId)

      const response = NextResponse.json(
        { 
          success: false, 
          error: transferResult.error || 'Transfer failed',
          refunded: true,
        },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Update transaction with SparkUp response
    await supabaseAdmin
      .from('payout_transactions')
      .update({ 
        transaction_id: transferResult.transaction_id,
        status: transferResult.status || 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('id', payoutTx.id)

    // Update ledger entry status
    await supabaseAdmin
      .from('wallet_ledger')
      .update({ status: 'completed' })
      .eq('id', ledgerId)

    const response = NextResponse.json({
      success: true,
      message: transferResult.remark || 'Transfer initiated successfully',
      transaction_id: payoutTx.id,
      provider_txn_id: transferResult.transaction_id,
      client_ref_id: transferResult.client_ref_id || clientRefId,
      status: (transferResult.status || 'processing').toUpperCase(),
      amount: transferResult.amount || amountNum,
      charges: transferResult.charges || charges,
      total_debited: transferResult.total_amount || totalAmount,
      account_number: accountNumber.replace(/\d(?=\d{4})/g, '*'),
      account_holder_name: accountHolderName,
      bank_name: bankName,
      transfer_mode: transferMode,
    })
    
    return addCorsHeaders(request, response)

  } catch (error: any) {
    console.error('[Payout Transfer] Error:', error)
    const response = NextResponse.json(
      { 
        success: false, 
        error: error.message || 'Transfer failed',
      },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

