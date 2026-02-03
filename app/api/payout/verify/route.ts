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

    // Verify account
    console.log('[Payout Verify] Verifying account for user:', user.partner_id)
    const result = await verifyBankAccount({
      accountNumber: normalizedAccountNumber,
      ifscCode: normalizedIfsc,
      bankName: bankName?.trim() || undefined,
    })

    if (!result.success) {
      console.error('[Payout Verify] Verification failed:', result.error)
      const response = NextResponse.json(
        { 
          success: false, 
          error: result.error || 'Account verification failed',
          is_valid: false,
        },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    console.log('[Payout Verify] Verification successful:', {
      account_holder: result.account_holder_name,
      bank: result.bank_name,
      is_valid: result.is_valid,
    })

    const response = NextResponse.json({
      success: true,
      is_valid: result.is_valid !== false,
      account_holder_name: result.account_holder_name,
      bank_name: result.bank_name,
      branch_name: result.branch_name,
      verification_charges: result.charges || 2,
      message: 'Account verified successfully',
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

