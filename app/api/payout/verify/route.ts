import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { createClient } from '@supabase/supabase-js'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { verifyBankAccount } from '@/services/payout'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * POST /api/payout/verify
 * 
 * Verifies bank account details before making a transfer.
 * Returns the account holder name if verification is successful.
 * 
 * Request Body:
 * - accountNumber: Bank account number
 * - ifscCode: IFSC code
 * - bankName: Bank name (optional)
 * - user_id: Fallback auth - retailer partner_id (if cookie auth fails)
 */
export async function POST(request: NextRequest) {
  try {
    // Parse request body first (needed for fallback auth)
    const body = await request.json()
    const { accountNumber, ifscCode, bankName, user_id } = body

    // Initialize Supabase client for fallback auth
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const supabase = createClient(supabaseUrl, supabaseServiceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

    // Try cookie-based auth first
    let user = await getCurrentUserFromRequest(request)
    
    // If cookie auth fails, try to verify user from request body (fallback)
    if ((!user || !user.partner_id) && user_id) {
      const { data: retailer } = await supabase
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
        console.log('[Payout Verify] Using fallback auth with user_id:', user.email)
      }
    }
    
    if (!user || !user.partner_id) {
      console.error('[Payout Verify] No authenticated user found')
      const response = NextResponse.json(
        { success: false, error: 'Authentication required. Please log in again.' },
        { status: 401 }
      )
      return addCorsHeaders(request, response)
    }

    // Retailers only (or admin for testing)
    const userRole = user.role as string | undefined
    if (!['retailer', 'admin', 'super_admin'].includes(userRole || '')) {
      const response = NextResponse.json(
        { success: false, error: 'Access denied' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    if (!accountNumber || !ifscCode) {
      const response = NextResponse.json(
        { success: false, error: 'Account number and IFSC code are required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Normalize inputs
    const normalizedAccountNumber = accountNumber.toString().replace(/\s+/g, '').trim()
    const normalizedIfsc = ifscCode.toString().replace(/\s+/g, '').trim().toUpperCase()

    // Account verification charges: ₹4
    const verificationCharges = 4

    // Check wallet balance before verification
    // Using the same wallet function as BBPS for consistency (get_wallet_balance with p_retailer_id)
    const { data: walletBalance, error: balanceError } = await (supabase as any).rpc('get_wallet_balance', {
      p_retailer_id: user.partner_id
    })

    if (balanceError) {
      console.error('[Payout Verify] Error fetching wallet balance:', balanceError)
      const response = NextResponse.json(
        { success: false, error: 'Failed to check wallet balance' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    if ((walletBalance || 0) < verificationCharges) {
      const response = NextResponse.json(
        { 
          success: false, 
          error: `Insufficient balance for account verification. Required: ₹${verificationCharges}, Available: ₹${(walletBalance || 0).toFixed(2)}`,
          is_valid: false,
        },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Generate transaction ID for verification
    const verificationTransactionId = `VERIFY_${user.partner_id}_${Date.now()}_${Math.random().toString(36).substring(7)}`

    // Debit wallet for verification charges
    // Using the same wallet function as BBPS for consistency (debit_wallet_bbps)
    // This ensures the same wallet system is used for both BBPS and Payout
    const { data: ledgerId, error: debitError } = await (supabase as any).rpc('debit_wallet_bbps', {
      p_retailer_id: user.partner_id,
      p_transaction_id: null, // No UUID transaction record for verification
      p_amount: verificationCharges,
      p_description: `Account verification charges for ${normalizedAccountNumber.substring(0, 4)}****${normalizedAccountNumber.slice(-4)} - ${normalizedIfsc}`,
      p_reference_id: verificationTransactionId
    })

    if (debitError) {
      console.error('[Payout Verify] Error debiting wallet:', debitError)
      const response = NextResponse.json(
        { success: false, error: 'Failed to deduct verification charges from wallet' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    // Verify account (after wallet deduction)
    console.log('[Payout Verify] Verifying account for user:', user.partner_id)
    const result = await verifyBankAccount({
      accountNumber: normalizedAccountNumber,
      ifscCode: normalizedIfsc,
      bankName: bankName?.trim() || undefined,
    })

    if (!result.success) {
      console.error('[Payout Verify] Verification failed:', result.error)
      // Note: We don't refund the charge if verification fails - charge is for the verification attempt
      const response = NextResponse.json(
        { 
          success: false, 
          error: result.error || 'Account verification failed',
          is_valid: false,
          verification_charges: verificationCharges,
          message: 'Verification charges have been deducted from your wallet',
        },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    console.log('[Payout Verify] Verification successful:', {
      account_holder: result.account_holder_name,
      bank: result.bank_name,
      is_valid: result.is_valid,
      charges_deducted: verificationCharges,
    })

    const response = NextResponse.json({
      success: true,
      is_valid: result.is_valid !== false,
      account_holder_name: result.account_holder_name,
      bank_name: result.bank_name,
      branch_name: result.branch_name,
      verification_charges: verificationCharges,
      transaction_id: verificationTransactionId,
      message: 'Account verified successfully. ₹4 verification charges have been deducted from your wallet.',
    })
    
    return addCorsHeaders(request, response)

  } catch (error: any) {
    console.error('[Payout Verify] Unexpected error:', {
      error: error.message,
      stack: error.stack,
      name: error.name,
    })
    const response = NextResponse.json(
      { 
        success: false, 
        error: error.message || 'An unexpected error occurred. Please try again later.',
      },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

