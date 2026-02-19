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

    // Fetch retailer's distributor chain for proper scheme hierarchy resolution
    let distributorId: string | null = null
    let mdId: string | null = null
    try {
      const { data: retailerData } = await supabaseAdmin
        .from('retailers')
        .select('distributor_id, master_distributor_id')
        .eq('partner_id', user.partner_id)
        .maybeSingle()
      distributorId = retailerData?.distributor_id || null
      mdId = retailerData?.master_distributor_id || null
    } catch (e) {
      console.warn('[Payout] Failed to fetch retailer hierarchy:', e)
    }

    // Calculate charges via Scheme Engine (with direct query fallback)
    let charges = 0
    let resolvedSchemeId: string | null = null
    let resolvedSchemeName: string | null = null
    
    try {
      console.log(`[Payout] Resolving scheme: user=${user.partner_id}, dist=${distributorId}, md=${mdId}, amount=${amountNum}, mode=${transferMode}`)
      
      const { data: schemeResult, error: schemeError } = await (supabaseAdmin as any).rpc('resolve_scheme_for_user', {
        p_user_id: user.partner_id,
        p_user_role: 'retailer',
        p_service_type: 'payout',
        p_distributor_id: distributorId,
        p_md_id: mdId,
      })
      
      if (schemeError) {
        console.error('[Payout] Scheme RPC error:', schemeError)
      } else if (schemeResult && schemeResult.length > 0) {
        const resolved = schemeResult[0]
        resolvedSchemeId = resolved.scheme_id
        resolvedSchemeName = resolved.scheme_name
        console.log(`[Payout] Scheme resolved via RPC: "${resolved.scheme_name}" via ${resolved.resolved_via}`)
        
        const { data: chargeResult, error: chargeError } = await (supabaseAdmin as any).rpc('calculate_payout_charge_from_scheme', {
          p_scheme_id: resolved.scheme_id,
          p_amount: amountNum,
          p_transfer_mode: transferMode,
        })
        
        if (chargeError) {
          console.error('[Payout] Charge calculation RPC error:', chargeError)
        } else if (chargeResult && chargeResult.length > 0 && parseFloat(chargeResult[0].retailer_charge) > 0) {
          charges = parseFloat(chargeResult[0].retailer_charge)
          console.log(`[Payout] Scheme charge via RPC: ₹${charges}`)
        } else {
          console.warn(`[Payout] RPC charge slab returned 0, trying direct query for scheme ${resolved.scheme_id}, amount=${amountNum}, mode=${transferMode}`)
          // Fallback: Direct table query for payout charge
          const { data: slabs } = await supabaseAdmin
            .from('scheme_payout_charges')
            .select('*')
            .eq('scheme_id', resolved.scheme_id)
            .eq('status', 'active')
            .lte('min_amount', amountNum)
            .gte('max_amount', amountNum)
            .order('min_amount', { ascending: false })

          if (slabs && slabs.length > 0) {
            const matchingSlab = slabs.find((s: any) => s.transfer_mode.toUpperCase() === transferMode.toUpperCase())
            if (matchingSlab) {
              const rc = parseFloat(matchingSlab.retailer_charge) || 0
              charges = matchingSlab.retailer_charge_type === 'percentage'
                ? Math.round(amountNum * rc / 100 * 100) / 100
                : rc
              console.log(`[Payout] Scheme charge via direct query: ₹${charges}`)
            }
          }
        }
      } else {
        console.warn(`[Payout] No scheme found via RPC for user=${user.partner_id}, trying direct query...`)
      }
    } catch (schemeErr) {
      console.error('[Payout] Scheme resolution RPC failed:', schemeErr)
    }
    
    // Fallback: Direct table query for scheme resolution (if RPC failed)
    if (!resolvedSchemeId) {
      try {
        console.log(`[Payout] Attempting direct table query scheme resolution...`)
        const now = new Date().toISOString()
        const { data: mappings } = await supabaseAdmin
          .from('scheme_mappings')
          .select(`
            scheme_id,
            service_type,
            effective_from,
            effective_to,
            scheme:schemes!inner (
              id, name, scheme_type, status, effective_from, effective_to
            )
          `)
          .eq('entity_id', user.partner_id)
          .eq('entity_role', 'retailer')
          .eq('status', 'active')
          .lte('effective_from', now)
          .order('priority', { ascending: true })
          .limit(5)

        if (mappings && mappings.length > 0) {
          for (const mapping of mappings as any[]) {
            const scheme = mapping.scheme as any
            if (!scheme || scheme.status !== 'active') continue
            if (mapping.effective_to && new Date(mapping.effective_to) <= new Date()) continue
            if (new Date(scheme.effective_from) > new Date()) continue
            if (scheme.effective_to && new Date(scheme.effective_to) <= new Date()) continue
            const svcType = mapping.service_type
            if (svcType && svcType !== 'all' && svcType !== 'payout') continue

            resolvedSchemeId = scheme.id
            resolvedSchemeName = scheme.name
            console.log(`[Payout] Scheme resolved via direct query: "${scheme.name}" (${scheme.id})`)

            // Now get payout charge from this scheme
            const { data: slabs } = await supabaseAdmin
              .from('scheme_payout_charges')
              .select('*')
              .eq('scheme_id', scheme.id)
              .eq('status', 'active')
              .lte('min_amount', amountNum)
              .gte('max_amount', amountNum)
              .order('min_amount', { ascending: false })

            if (slabs && slabs.length > 0) {
              const matchingSlab = slabs.find((s: any) => s.transfer_mode.toUpperCase() === transferMode.toUpperCase())
              if (matchingSlab) {
                const rc = parseFloat(matchingSlab.retailer_charge) || 0
                charges = matchingSlab.retailer_charge_type === 'percentage'
                  ? Math.round(amountNum * rc / 100 * 100) / 100
                  : rc
                console.log(`[Payout] Scheme charge via direct query: ₹${charges}`)
              }
            }
            break
          }
        }
      } catch (directErr) {
        console.error('[Payout] Direct query scheme resolution failed:', directErr)
      }
    }
    
    // Final fallback to env-based charges if no scheme resolved at all
    if (!resolvedSchemeId) {
      console.warn(`[Payout] No scheme resolved (RPC + direct query failed), using env config`)
      const chargesConfig = getPayoutCharges()
      charges = transferMode === 'IMPS' ? chargesConfig.imps : chargesConfig.neft
    }
    
    const totalAmount = amountNum + charges

    // Check retailer's wallet balance
    // Using the same wallet function as BBPS for consistency (get_wallet_balance with p_retailer_id)
    const { data: walletBalance, error: balanceError } = await (supabaseAdmin as any).rpc('get_wallet_balance', {
      p_retailer_id: user.partner_id
    })

    if (balanceError) {
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

    // ========== DUPLICATE TRANSACTION PREVENTION ==========
    // Check for recent transactions to same account within 2 minutes
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    const { data: recentTx, error: recentTxError } = await supabaseAdmin
      .from('payout_transactions')
      .select('id, status, created_at, amount')
      .eq('retailer_id', user.partner_id)
      .eq('account_number', accountNumber)
      .gte('created_at', twoMinutesAgo)
      .in('status', ['pending', 'processing', 'success'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!recentTxError && recentTx) {
      const timeSinceLastTx = Math.round((Date.now() - new Date(recentTx.created_at).getTime()) / 1000)
      const waitTime = 120 - timeSinceLastTx
      
      console.warn('[Payout Transfer] Duplicate transaction blocked:', {
        retailer_id: user.partner_id,
        account_number: accountNumber.replace(/\d(?=\d{4})/g, '*'),
        recent_tx_id: recentTx.id,
        recent_tx_status: recentTx.status,
        seconds_ago: timeSinceLastTx,
      })
      
      const response = NextResponse.json(
        { 
          success: false, 
          error: `A transaction to this account was initiated ${timeSinceLastTx} seconds ago (Status: ${recentTx.status.toUpperCase()}). Please wait ${waitTime} seconds before retrying to prevent duplicate transfers.`,
          duplicate_prevention: true,
          recent_transaction: {
            id: recentTx.id,
            status: recentTx.status,
            amount: recentTx.amount,
            created_at: recentTx.created_at,
          },
          wait_seconds: waitTime,
        },
        { status: 429 }  // Too Many Requests
      )
      return addCorsHeaders(request, response)
    }
    // ========== END DUPLICATE PREVENTION ==========

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
        // Scheme linkage
        ...(resolvedSchemeId ? { scheme_id: resolvedSchemeId, scheme_name: resolvedSchemeName, retailer_charge: charges } : {}),
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
    // Using the same wallet function as BBPS for consistency (debit_wallet_bbps)
    const { data: ledgerId, error: ledgerError } = await (supabaseAdmin as any).rpc('debit_wallet_bbps', {
      p_retailer_id: user.partner_id,
      p_transaction_id: payoutTx.id,
      p_amount: totalAmount,
      p_description: `Payout to ${accountHolderName} - ${accountNumber} via ${transferMode}`,
      p_reference_id: clientRefId
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

    // ========== HANDLE TIMEOUT SCENARIO ==========
    // If it's a timeout, DON'T refund - transaction may still be processing
    if (transferResult.is_timeout) {
      console.warn('[Payout Transfer] Server timeout - keeping transaction as processing:', {
        transaction_id: payoutTx.id,
        client_ref_id: clientRefId,
      })

      // Update transaction as processing (not failed, not pending) - no refund
      // Don't set failure_reason - it's not a failure, just slow processing
      await supabaseAdmin
        .from('payout_transactions')
        .update({ 
          status: 'processing',
          updated_at: new Date().toISOString()
        })
        .eq('id', payoutTx.id)

      // Keep ledger entry as completed (money is being transferred)
      await supabaseAdmin
        .from('wallet_ledger')
        .update({ status: 'completed' })
        .eq('id', ledgerId)

      const response = NextResponse.json({
        success: true,  // Return success to UI - transaction is processing
        message: 'Transfer initiated successfully. Processing may take a few minutes.',
        transaction_id: payoutTx.id,
        client_ref_id: clientRefId,
        status: 'PROCESSING',
        amount: amountNum,
        charges,  // Always use scheme-based charges
        total_debited: totalAmount,
        account_number: accountNumber.replace(/\d(?=\d{4})/g, '*'),
        account_holder_name: accountHolderName,
        bank_name: bankName,
        transfer_mode: transferMode,
        ...(resolvedSchemeName ? { scheme_name: resolvedSchemeName } : {}),
      })
      return addCorsHeaders(request, response)
    }
    // ========== END TIMEOUT HANDLING ==========

    if (!transferResult.success) {
      // Refund the wallet - only for actual failures (not timeouts)
      // Using the same wallet function as BBPS for consistency (refund_wallet_bbps)
      await (supabaseAdmin as any).rpc('refund_wallet_bbps', {
        p_retailer_id: user.partner_id,
        p_transaction_id: payoutTx.id,
        p_amount: totalAmount,
        p_description: `Payout failed - Refund: ${transferResult.error}`,
        p_reference_id: `REFUND_${clientRefId}`
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
      amount: amountNum,
      charges,  // Always use scheme-based charges (not transfer service config charges)
      total_debited: totalAmount,  // Always use scheme-calculated total
      account_number: accountNumber.replace(/\d(?=\d{4})/g, '*'),
      account_holder_name: accountHolderName,
      bank_name: bankName,
      transfer_mode: transferMode,
      ...(resolvedSchemeName ? { scheme_name: resolvedSchemeName } : {}),
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

