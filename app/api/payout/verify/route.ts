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
 * 
 * IMPORTANT: SparkupX Payout API does NOT have an account verification endpoint
 * as per the documentation (Feb 2026). This endpoint only performs LOCAL validation.
 * 
 * The available SparkupX endpoints are:
 * - bankList, expressPay2, statusCheck, getBalance
 * 
 * Until SparkupX provides an account verification API:
 * - NO charges are deducted (since no API call is made)
 * - Only local format validation is performed
 * - Beneficiary name CANNOT be fetched from the bank
 * - User must manually confirm the beneficiary name
 * 
 * Request Body:
 * - accountNumber: Bank account number
 * - ifscCode: IFSC code
 * - bankName: Bank name (optional)
 * - bankId: Bank ID from bank list (optional)
 * - user_id: Fallback auth - retailer partner_id (if cookie auth fails)
 */
export async function POST(request: NextRequest) {
  try {
    // Parse request body first (needed for fallback auth)
    const body = await request.json()
    const { accountNumber, ifscCode, bankName, bankId, user_id } = body

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

    console.log('[Payout Verify] Verifying account for user:', user.partner_id)
    console.log('[Payout Verify] Account:', normalizedAccountNumber.substring(0, 4) + '****' + normalizedAccountNumber.slice(-4))
    console.log('[Payout Verify] IFSC:', normalizedIfsc)

    // ============================================================
    // NOTE: SparkupX verification API is NOT available
    // NO charges are deducted - only local validation is performed
    // ============================================================
    
    const result = await verifyBankAccount({
      accountNumber: normalizedAccountNumber,
      ifscCode: normalizedIfsc,
      bankName: bankName?.trim() || undefined,
      bankId: bankId ? parseInt(bankId) : undefined,
    })

    if (!result.success) {
      console.error('[Payout Verify] Validation failed:', result.error)
      const response = NextResponse.json(
        { 
          success: false, 
          error: result.error || 'Account validation failed',
          is_valid: false,
          verification_charges: 0, // No charges since SparkupX API not available
        },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    console.log('[Payout Verify] Validation result:', {
      verification_type: result.verification_type,
      is_valid: result.is_valid,
      bank: result.bank_name,
      has_name: !!result.account_holder_name,
    })

    // Return response with clear indication that name verification is not available
    const response = NextResponse.json({
      success: true,
      is_valid: result.is_valid !== false,
      account_holder_name: result.account_holder_name || null, // null means "not available"
      bank_name: result.bank_name,
      branch_name: result.branch_name,
      verification_charges: 0, // No charges since SparkupX API not available
      verification_type: result.verification_type || 'local',
      message: result.message || 'Account format validated. Please enter and confirm the beneficiary name manually.',
      // Important warning for user
      warning: !result.account_holder_name 
        ? 'Beneficiary name verification is not available from SparkupX. Please verify the account holder name before proceeding with the transfer.'
        : undefined,
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
