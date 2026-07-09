import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { getCurrentUserWithFallback } from '@/lib/auth-server'

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
 * Verifies bank account details before making a transfer or settlement.
 * 
 * Validates account details and returns the beneficiary name.
 * 
 * API Documentation: https://documenter.getpostman.com/view/44095803/2sB3BGGVAw#181b2d01-1993-4826-b921-8d32d510a751
 * 
 * Features:
 * - Validates account number and IFSC code format
 * - Calls payout API to verify account exists
 * - Returns beneficiary name from bank
 * - No charges (penniless transaction)
 * 
 * Request Body:
 * - accountNumber: Bank account number
 * - ifscCode: IFSC code
 * - bankName: Bank name (optional)
 * - bankId: Bank ID from bank list (optional)
 */
export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json()
    const { accountNumber, ifscCode, bankName, bankId } = body

    const user = (await getCurrentUserWithFallback(request)).user
    
    if (!user || !user.partner_id) {
      console.error('[Payout Verify] No authenticated user found')
      const response = NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      )
      return addCorsHeaders(request, response)
    }

    const userRole = user.role as string | undefined
    if (!['retailer', 'partner', 'admin', 'super_admin'].includes(userRole || '')) {
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

    // Call validate_account API to verify account and get beneficiary name
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
          verification_charges: 0,
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
      reference_id: result.reference_id,
    })

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, {
      activity_type: 'payout_verify_account',
      activity_category: 'payout',
      activity_description: `Verified bank account ${normalizedIfsc}`,
      metadata: { ifscCode: normalizedIfsc, accountNumber: normalizedAccountNumber?.slice(-4) },
    }).catch(() => {})

    // Return response with beneficiary name from API
    const response = NextResponse.json({
      success: true,
      is_valid: result.is_valid !== false,
      account_holder_name: result.account_holder_name || null, // Beneficiary name from API
      bank_name: result.bank_name,
      branch_name: result.branch_name,
      verification_charges: 0, // Penniless transaction - no charges
      verification_type: result.verification_type || 'api',
      message: result.message || 'Account verified successfully',
      reference_id: result.reference_id,
      uuid: result.uuid,
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
