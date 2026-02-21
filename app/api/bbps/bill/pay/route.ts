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
        // Fallback auth active (cross-origin — no Supabase cookies)
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
    const { biller_id, consumer_number, amount, biller_name, consumer_name, due_date, bill_date, bill_number, additional_info, biller_category, tpin, reqId, payment_mode, is_prepaid, pan_number } = body

    if (!biller_id || !consumer_number || !amount) {
      const response = NextResponse.json(
        { error: 'biller_id, consumer_number, and amount are required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // NEW: billerName is required per Sparkup API update (Jan 2026)
    if (!biller_name || biller_name.trim() === '') {
      const response = NextResponse.json(
        { error: 'billerName is required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // PAN number is required for payments above ₹49,999
    const billAmountForPanCheck = parseFloat(amount)
    const PAN_THRESHOLD_PAISE = 49999 * 100 // ₹49,999 in paise
    if (!isNaN(billAmountForPanCheck) && billAmountForPanCheck > PAN_THRESHOLD_PAISE) {
      if (!pan_number || typeof pan_number !== 'string' || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan_number.trim().toUpperCase())) {
        const response = NextResponse.json(
          { error: 'Valid PAN number is required for payments above ₹49,999', pan_required: true },
          { status: 400 }
        )
        return addCorsHeaders(request, response)
      }
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
    
    // Fetch retailer's distributor chain for proper scheme hierarchy resolution
    let distributorId: string | null = null
    let mdId: string | null = null
    try {
      const { data: retailerData } = await supabase
        .from('retailers')
        .select('distributor_id, master_distributor_id')
        .eq('partner_id', user.partner_id)
        .maybeSingle()
      distributorId = retailerData?.distributor_id || null
      mdId = retailerData?.master_distributor_id || null
    } catch (e) {
      console.warn('[BBPS Pay] Failed to fetch retailer hierarchy:', e)
    }

    // Calculate BBPS charge via Scheme Engine (with direct query fallback)
    let bbpsCharge = 20 // Default
    let resolvedSchemeId: string | null = null
    let resolvedSchemeName: string | null = null
    
    try {
      // Try scheme-based charge calculation first (RPC)
      console.log(`[BBPS Pay] Resolving scheme: user=${user.partner_id}, dist=${distributorId}, md=${mdId}, amount=${billAmountInRupees}, category=${additional_info?.category}`)
      
      const { data: schemeResult, error: schemeError } = await (supabase as any).rpc('resolve_scheme_for_user', {
        p_user_id: user.partner_id,
        p_user_role: 'retailer',
        p_service_type: 'bbps',
        p_distributor_id: distributorId,
        p_md_id: mdId,
      })
      
      if (schemeError) {
        console.error('[BBPS Pay] Scheme RPC error:', schemeError)
      } else if (schemeResult && schemeResult.length > 0) {
        const resolved = schemeResult[0]
        resolvedSchemeId = resolved.scheme_id
        resolvedSchemeName = resolved.scheme_name
        console.log(`[BBPS Pay] Scheme resolved via RPC: "${resolved.scheme_name}" via ${resolved.resolved_via}`)
        
        const { data: chargeResult, error: chargeError } = await (supabase as any).rpc('calculate_bbps_charge_from_scheme', {
          p_scheme_id: resolved.scheme_id,
          p_amount: billAmountInRupees,
          p_category: additional_info?.category || null,
        })
        
        if (chargeError) {
          console.error('[BBPS Pay] Charge calculation RPC error:', chargeError)
        } else if (chargeResult && chargeResult.length > 0 && parseFloat(chargeResult[0].retailer_charge) > 0) {
          bbpsCharge = parseFloat(chargeResult[0].retailer_charge)
          console.log(`[BBPS Pay] Scheme charge via RPC: ₹${bbpsCharge}`)
        } else {
          console.warn(`[BBPS Pay] RPC charge slab returned 0 for scheme ${resolved.scheme_id}, trying direct query...`)
          // Fallback: Direct table query for BBPS charge
          const { data: slabs } = await supabase
            .from('scheme_bbps_commissions')
            .select('*')
            .eq('scheme_id', resolved.scheme_id)
            .eq('status', 'active')
            .lte('min_amount', billAmountInRupees)
            .gte('max_amount', billAmountInRupees)
            .order('min_amount', { ascending: false })

          if (slabs && slabs.length > 0) {
            // Find best slab (prefer wildcard category match)
            const cat = additional_info?.category || null
            const bestSlab = slabs.find((s: any) => {
              const sc = s.category
              return !sc || sc === '' || sc.toLowerCase() === 'all' || sc.toLowerCase() === 'all categories' || sc === cat || !cat
            })
            if (bestSlab) {
              const rc = parseFloat(bestSlab.retailer_charge) || 0
              bbpsCharge = bestSlab.retailer_charge_type === 'percentage'
                ? Math.round(billAmountInRupees * rc / 100 * 100) / 100
                : rc
              console.log(`[BBPS Pay] Scheme charge via direct query: ₹${bbpsCharge}`)
            }
          }
        }
      } else {
        console.warn(`[BBPS Pay] No scheme found via RPC for user=${user.partner_id}, trying direct query...`)
      }
    } catch (schemeErr) {
      console.error('[BBPS Pay] Scheme resolution RPC failed:', schemeErr)
    }
    
    // Fallback: Direct table query for scheme resolution (if RPC failed)
    if (!resolvedSchemeId) {
      try {
        console.log(`[BBPS Pay] Attempting direct table query scheme resolution...`)
        const now = new Date().toISOString()
        const { data: mappings } = await supabase
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
            if (svcType && svcType !== 'all' && svcType !== 'bbps') continue

            resolvedSchemeId = scheme.id
            resolvedSchemeName = scheme.name
            console.log(`[BBPS Pay] Scheme resolved via direct query: "${scheme.name}" (${scheme.id})`)

            // Now get BBPS charge from this scheme
            const { data: slabs } = await supabase
              .from('scheme_bbps_commissions')
              .select('*')
              .eq('scheme_id', scheme.id)
              .eq('status', 'active')
              .lte('min_amount', billAmountInRupees)
              .gte('max_amount', billAmountInRupees)
              .order('min_amount', { ascending: false })

            if (slabs && slabs.length > 0) {
              const cat = additional_info?.category || null
              const bestSlab = slabs.find((s: any) => {
                const sc = s.category
                return !sc || sc === '' || sc.toLowerCase() === 'all' || sc.toLowerCase() === 'all categories' || sc === cat || !cat
              })
              if (bestSlab) {
                const rc = parseFloat(bestSlab.retailer_charge) || 0
                bbpsCharge = bestSlab.retailer_charge_type === 'percentage'
                  ? Math.round(billAmountInRupees * rc / 100 * 100) / 100
                  : rc
                console.log(`[BBPS Pay] Scheme charge via direct query: ₹${bbpsCharge}`)
              }
            }
            break
          }
        }
      } catch (directErr) {
        console.error('[BBPS Pay] Direct query scheme resolution failed:', directErr)
      }
    }
    
    // Final fallback to legacy RPC if no scheme resolved at all
    if (!resolvedSchemeId) {
      console.warn(`[BBPS Pay] No scheme resolved (RPC + direct query failed), using legacy charge`)
      const { data: chargeData } = await (supabase as any).rpc('calculate_transaction_charge', {
        p_amount: billAmountInRupees,
        p_transaction_type: 'bbps'
      })
      bbpsCharge = chargeData || 20
    }
    
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
        // PAN number (required for payments above ₹49,999)
        ...(pan_number ? { pan_number: pan_number.trim().toUpperCase() } : {}),
        // Scheme linkage
        ...(resolvedSchemeId ? { scheme_id: resolvedSchemeId, scheme_name: resolvedSchemeName, retailer_charge: bbpsCharge } : {}),
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
    // Using add_ledger_entry which is proven to work correctly:
    //   - Locks wallet row with FOR UPDATE (prevents race conditions)
    //   - Updates wallets table balance
    //   - Inserts proper ledger entry with opening/closing balance
    let debitLedgerId: string | null = null
    try {
      console.log(`[BBPS Pay] 💰 Debiting retailer wallet: ₹${totalAmountNeeded} (Bill: ₹${billAmountInRupees} + Charge: ₹${bbpsCharge})`)
      console.log(`[BBPS Pay] Retailer: ${user.partner_id}, Wallet balance before: ₹${walletBalance}`)
      
      const { data: ledgerId, error: debitError } = await supabase.rpc('add_ledger_entry', {
        p_user_id: user.partner_id,
        p_user_role: 'retailer',
        p_wallet_type: 'primary',
        p_fund_category: 'bbps',
        p_service_type: 'bbps',
        p_tx_type: 'BBPS_DEBIT',
        p_credit: 0,
        p_debit: totalAmountNeeded,
        p_reference_id: agentTransactionId,
        p_transaction_id: bbpsTransaction.id,
        p_status: 'completed',
        p_remarks: `BBPS Payment - ${biller_name || biller_id} - Consumer: ${consumer_number} (Bill: ₹${billAmountInRupees}, Charge: ₹${bbpsCharge})`,
      })

      if (debitError) {
        console.error('[BBPS Pay] ❌ Error debiting wallet via add_ledger_entry:', debitError)
        // Update transaction status to failed
        await supabase
          .from('bbps_transactions')
          .update({ 
            status: 'failed',
            error_message: 'Failed to debit wallet: ' + debitError.message,
          })
          .eq('id', bbpsTransaction.id)

        const response = NextResponse.json(
          { error: 'Failed to debit wallet: ' + debitError.message },
          { status: 500 }
        )
        return addCorsHeaders(request, response)
      }
      
      debitLedgerId = ledgerId
      console.log(`[BBPS Pay] ✅ Wallet debited successfully. Ledger ID: ${ledgerId}, New balance: ₹${walletBalance - totalAmountNeeded}`)
      
      // Update bbps_transactions to mark wallet as debited
      await supabase
        .from('bbps_transactions')
        .update({ 
          wallet_debited: true,
          wallet_debit_id: ledgerId,
        })
        .eq('id', bbpsTransaction.id)
    } catch (debitError: any) {
      console.error('[BBPS Pay] ❌ Exception debiting wallet:', debitError)
      // Update transaction status to failed
      await supabase
        .from('bbps_transactions')
        .update({ 
          status: 'failed',
          error_message: debitError.message || 'Failed to debit wallet',
        })
        .eq('id', bbpsTransaction.id)

      const response = NextResponse.json(
        { error: debitError.message || 'Failed to debit wallet' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    // ========================================
    // STEP 4: Prepare Sparkup API Request
    // ========================================
    
    // Prepare inputParams - ensure each param has valid paramName and paramValue
    // Sparkup API REQUIRES "paramName" field for each input parameter
    // IMPORTANT: Use the exact inputParams from the fetchBill response to ensure consistency
    let inputParams: Array<{ paramName: string; paramValue: string }> = []
    
    // Priority: Use inputParams from additional_info (frontend-provided), 
    // but also check additional_info.inputParams.input format (from fetchBill response)
    const providedInputParams = additional_info?.inputParams
    const fetchedInputParams = additional_info?.inputParams?.input || 
                               additional_info?.data?.inputParams?.input ||
                               []
    
    if (providedInputParams && Array.isArray(providedInputParams)) {
      // Frontend sent inputParams array directly
      inputParams = providedInputParams
        .filter((param: any) => param && param.paramName && typeof param.paramName === 'string' && param.paramName.trim() !== '')
        .map((param: any) => ({
          paramName: param.paramName.trim(),
          paramValue: String(param.paramValue || '').trim(),
        }))
    } else if (fetchedInputParams && Array.isArray(fetchedInputParams) && fetchedInputParams.length > 0) {
      // Use inputParams from fetchBill response (format: { input: [...] })
      inputParams = fetchedInputParams
        .filter((param: any) => param && param.paramName && typeof param.paramName === 'string' && param.paramName.trim() !== '')
        .map((param: any) => ({
          paramName: param.paramName.trim(),
          paramValue: String(param.paramValue || '').trim(),
        }))
    }
    
    // If no valid inputParams, use consumer_number as fallback
    if (inputParams.length === 0) {
      inputParams = [
        {
          paramName: 'Consumer Number',
          paramValue: consumer_number,
        }
      ]
    }

    // billerAdhoc must be boolean true/false (NOT string) per production-tested format
    // Get from biller metadata if available, default to true for adhoc billers
    const billerAdhocString = additional_info?.metadata?.billerAdhoc || 
                              additional_info?.billerAdhoc || 
                              true

    // Per Sparkup API documentation, sub_service_name MUST be the category name
    // e.g., "Credit Card", "Electricity", "DTH", etc. (case + spaces must match exactly)
    const subServiceName = biller_category || 
                           additional_info?.metadata?.billerCategory ||
                           additional_info?.billerCategory ||
                           additional_info?.category ||
                           'Credit Card' // Fallback - should always be provided by frontend

    // Prepare paymentInfo - Sparkup requires items with infoName and infoValue
    // IMPORTANT: Filter out any items without valid infoName to prevent "Additional info name is required" error
    // NOTE: paymentInfo is overridden by payRequest service based on paymentMode (Cash/Wallet)
    // so this is only used as a fallback - the service builds the correct format
    let paymentInfo: Array<{ infoName: string; infoValue: string }> = []
    
    if (additional_info?.paymentInfo && Array.isArray(additional_info.paymentInfo)) {
      paymentInfo = additional_info.paymentInfo
        .filter((info: any) => info && info.infoName && typeof info.infoName === 'string' && info.infoName.trim() !== '')
        .map((info: any) => ({
          infoName: info.infoName.trim(),
          infoValue: String(info.infoValue || '').trim(),
        }))
    }
    
    // Default paymentInfo matching production-tested format (Feb 2026)
    // For Cash mode: { infoName: "Payment Account Info", infoValue: "Cash Payment" }
    if (paymentInfo.length === 0) {
      paymentInfo = [
        {
          infoName: 'Payment Account Info',
          infoValue: 'Cash Payment'
        }
      ]
    }
    
    // ========================================
    // CRITICAL: Extract billerResponse and additionalInfo from fetchBill response
    // These MUST match the EXACT format from the working Postman request:
    //   billerResponse: { billAmount, billDate, customerName, dueDate } — ONLY these 4 fields
    //   additionalInfo: [ { infoName, infoValue }, ... ] — FLAT array, NOT { info: [...] }
    // ========================================
    
    // Extract billerResponse — ONLY include the 4 fields from working Postman format
    let billerResponse: any = undefined
    if (additional_info?.billerResponse) {
      // Clean billerResponse to ONLY include required fields
      // Extra fields (billNumber, billPeriod, amountOptions, etc.) can cause Sparkup to reject
      const raw = additional_info.billerResponse
      billerResponse = {}
      if (raw.billAmount !== undefined && raw.billAmount !== null && raw.billAmount !== '') {
        billerResponse.billAmount = String(raw.billAmount)
      }
      if (raw.billDate) billerResponse.billDate = raw.billDate
      if (raw.customerName) billerResponse.customerName = raw.customerName
      if (raw.dueDate) billerResponse.dueDate = raw.dueDate
      
      console.log('[BBPS Pay] ✅ Cleaned billerResponse (only 4 fields):', JSON.stringify(billerResponse, null, 2))
    } else if (bill_date || due_date || consumer_name) {
      // Fallback: construct from request body fields
      const billAmountInPaiseStr = String(Math.round(billAmountInRupees * 100))
      billerResponse = {
        billAmount: billAmountInPaiseStr,
      }
      if (bill_date) billerResponse.billDate = bill_date
      if (consumer_name) billerResponse.customerName = consumer_name
      if (due_date) billerResponse.dueDate = due_date
      console.log('[BBPS Pay] ⚠️ billerResponse fallback:', JSON.stringify(billerResponse, null, 2))
    }
    
    // Extract additionalInfo as FLAT array — handle both formats:
    //   Format 1 (from fetchBill raw): { info: [ {infoName, infoValue}, ... ] }
    //   Format 2 (already flat): [ {infoName, infoValue}, ... ]
    let additionalInfoArray: Array<{ infoName: string; infoValue: string }> | undefined
    
    const rawAdditionalInfo = additional_info?.additionalInfo
    if (rawAdditionalInfo) {
      if (Array.isArray(rawAdditionalInfo)) {
        // Already flat array
        additionalInfoArray = rawAdditionalInfo
          .filter((item: any) => item && item.infoName)
          .map((item: any) => ({ infoName: String(item.infoName), infoValue: String(item.infoValue || '') }))
        console.log('[BBPS Pay] ✅ additionalInfo is flat array:', additionalInfoArray.length, 'items')
      } else if (rawAdditionalInfo.info && Array.isArray(rawAdditionalInfo.info)) {
        // Wrapped in { info: [...] } — extract inner array
        additionalInfoArray = rawAdditionalInfo.info
          .filter((item: any) => item && item.infoName)
          .map((item: any) => ({ infoName: String(item.infoName), infoValue: String(item.infoValue || '') }))
        console.log('[BBPS Pay] ✅ additionalInfo extracted from {info:[...]}:', additionalInfoArray?.length ?? 0, 'items')
      }
    }
    
    // Also check nested locations
    if (!additionalInfoArray) {
      const nested = additional_info?.data?.additionalInfo
      if (nested) {
        const source = Array.isArray(nested) ? nested : (nested.info && Array.isArray(nested.info) ? nested.info : null)
        if (source) {
          additionalInfoArray = source
            .filter((item: any) => item && item.infoName)
            .map((item: any) => ({ infoName: String(item.infoName), infoValue: String(item.infoValue || '') }))
          console.log('[BBPS Pay] ✅ additionalInfo from nested data:', additionalInfoArray?.length ?? 0, 'items')
        }
      }
    }
    
    // Log values being sent to Sparkup
    console.log('=== BBPS Pay Request — Values for Sparkup ===')
    console.log('reqId:', reqId || additional_info?.reqId || 'NOT PROVIDED!')
    console.log('billerId:', biller_id)
    console.log('billerName:', biller_name)
    console.log('amount (₹):', billAmountInRupees)
    console.log('subServiceName:', subServiceName)
    console.log('inputParams:', JSON.stringify(inputParams, null, 2))
    console.log('billerResponse:', JSON.stringify(billerResponse, null, 2))
    console.log('additionalInfo:', JSON.stringify(additionalInfoArray, null, 2))
    if (!reqId && !additional_info?.reqId) console.warn('⚠️ reqId is missing!')
    if (!billerResponse) console.warn('⚠️ billerResponse is missing!')
    if (!additionalInfoArray || additionalInfoArray.length === 0) console.warn('⚠️ additionalInfo is missing or empty!')
    console.log('==============================================')

    // Make payment to BBPS API using new service
    // IMPORTANT: Sparkup Pay Request API expects amount in RUPEES (not paise)
    // Sparkup confirmed: send actual payable amount directly (e.g., 200 for ₹200, NOT 20000)
    // CRITICAL: Pass reqId from fetchBill to correlate payment with the fetched bill data
    // Determine payment mode - use provided, or from metadata, or default
    // Per Sparkup API docs (Jan 2026 update), "Cash" is recommended
    const effectivePaymentMode = payment_mode || 
                                  additional_info?.metadata?.paymentMode ||
                                  additional_info?.paymentMode ||
                                  'Cash' // Per Sparkup API update (Jan 2026) - Cash is widely supported
    
    console.log('Payment mode:', effectivePaymentMode)
    
    // Extract customer mobile number from inputParams for Wallet payment mode
    // Look for common mobile number field names
    let customerMobileNumber: string | undefined
    const mobileParamNames = ['Mobile Number', 'Registered Mobile Number', 'MobileNo', 'Mobile No', 'Customer Mobile']
    for (const param of inputParams) {
      if (mobileParamNames.some(name => param.paramName.toLowerCase().includes(name.toLowerCase().replace(' ', '')))) {
        customerMobileNumber = param.paramValue
        break
      }
    }
    console.log('Customer mobile number for Wallet mode:', customerMobileNumber || 'Not found in inputParams')
    
    // Convert billerAdhoc from string to boolean
    const billerAdhocBoolean = billerAdhocString === 'true' || billerAdhocString === true
    
    // Convert custConvFee to number (default 1 as per tested API)
    const custConvFeeNumber = additional_info?.custConvFee 
      ? (typeof additional_info.custConvFee === 'number' ? additional_info.custConvFee : parseFloat(String(additional_info.custConvFee)) || 1)
      : 1
    
    const paymentResponse = await payRequest({
      billerId: biller_id,
      billerName: biller_name,
      consumerNumber: consumer_number,
      amount: billAmountInRupees, // Send in RUPEES to Sparkup API (not paise!)
      agentTransactionId: agentTransactionId,
      inputParams,
      subServiceName, // MUST be category name like "Credit Card", "Electricity" (exact match)
      custConvFee: custConvFeeNumber, // Number (not string) - default 1
      billerAdhoc: billerAdhocBoolean, // Boolean (not string) - default true
      paymentInfo, // Will be overridden by payRequest based on paymentMode
      paymentMode: effectivePaymentMode, // "Cash", "Account", "Wallet", "UPI"
      quickPay: 'N', // "N" for non-quick pay (bill fetch was done) - as per tested API
      customerMobileNumber,
      // CRITICAL: Pass the reqId from fetchBill to correlate payment with BBPS provider
      reqId: reqId || additional_info?.reqId,
      // NOTE: billNumber is NOT included — not in working Postman format
      // Include CLEANED billerResponse and additionalInfo (matching Postman format exactly)
      billerResponse,
      additionalInfo: additionalInfoArray,
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
          console.log(`[BBPS Pay] 🔄 Refunding retailer wallet: ₹${totalAmountNeeded} (payment failed)`)
          const { data: refundLedgerId, error: refundError } = await supabase.rpc('add_ledger_entry', {
            p_user_id: user.partner_id,
            p_user_role: 'retailer',
            p_wallet_type: 'primary',
            p_fund_category: 'bbps',
            p_service_type: 'bbps',
            p_tx_type: 'BBPS_REFUND',
            p_credit: totalAmountNeeded,
            p_debit: 0,
            p_reference_id: `REFUND_${agentTransactionId}`,
            p_transaction_id: bbpsTransaction.id,
            p_status: 'completed',
            p_remarks: `BBPS Payment Refund - ${paymentResponse.error_message || 'Payment failed'} (Bill: ₹${billAmountInRupees}, Charge: ₹${bbpsCharge})`,
          })
          if (refundError) {
            console.error('[BBPS Pay] ❌ Error refunding wallet:', refundError)
            updateData.error_message = (updateData.error_message || '') + ' [REFUND_FAILED: Manual review required]'
          } else {
            console.log(`[BBPS Pay] ✅ Wallet refunded. Ledger ID: ${refundLedgerId}`)
          }
        } catch (refundError) {
          console.error('[BBPS Pay] ❌ Exception refunding wallet:', refundError)
          // Log error but don't fail the response - flag for admin review
          updateData.error_message = (updateData.error_message || '') + ' [REFUND_FAILED: Manual review required]'
        }
      }
    }

    await supabase
      .from('bbps_transactions')
      .update(updateData)
      .eq('id', bbpsTransaction.id)

    // Get updated wallet balance after transaction
    let newWalletBalance = walletBalance
    try {
      const { data: updatedBalance } = await supabase.rpc('get_wallet_balance_v2', {
        p_user_id: user.partner_id,
        p_wallet_type: 'primary'
      })
      newWalletBalance = updatedBalance || walletBalance
    } catch (e) {
      // Fallback to calculated balance
      newWalletBalance = paymentResponse.success 
        ? walletBalance - totalAmountNeeded 
        : walletBalance
    }
    
    console.log(`[BBPS Pay] Final wallet balance: ₹${newWalletBalance}`)

    const response = NextResponse.json({
      success: paymentResponse.success,
      transaction_id: bbpsTransaction.id,
      agent_transaction_id: agentTransactionId,
      bbps_transaction_id: paymentResponse.transaction_id,
      status: updateData.status,
      payment_status: updateData.payment_status,
      error_code: paymentResponse.error_code,
      error_message: paymentResponse.error_message,
      wallet_balance: newWalletBalance,
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

