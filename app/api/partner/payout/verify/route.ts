/**
 * POST /api/partner/payout/verify
 *
 * Penny-drop account verification via eKYC Hub (penny-less endpoint).
 * FREE — no wallet charge.
 *
 * Returns the bank-verified account holder name so the partner can
 * confirm account details before registering via POST /accounts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { verifyBankPennyLess, generateOrderId } from '@/services/ekyc'
import { isAccountVerificationEnabled, ACCOUNT_VERIFICATION_DISABLED_MESSAGE } from '@/lib/settings/account-verification'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function POST(request: NextRequest) {
  try {
    let authResult
    try {
      authResult = await authenticatePartner(request)
    } catch (error) {
      const e = error as PartnerAuthError
      return NextResponse.json(
        { success: false, error: { code: e.code, message: e.message } },
        { status: e.status }
      )
    }

    const { partner } = authResult
    const payoutAccess = partnerCanUseApi(partner, 'payout')
    if (!payoutAccess.allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: payoutAccess.message } },
        { status: 403 }
      )
    }

    // Check global verification toggle (admin can disable during provider outages)
    if (!(await isAccountVerificationEnabled())) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: ACCOUNT_VERIFICATION_DISABLED_MESSAGE },
          is_valid: false,
          verification_charges: 0,
        },
        { status: 503 }
      )
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
        { status: 400 }
      )
    }

    const { accountNumber, ifscCode } = body

    if (!accountNumber || !ifscCode) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'accountNumber and ifscCode are required' } },
        { status: 400 }
      )
    }

    const normalizedAccount = accountNumber.toString().replace(/\D/g, '').trim()
    const normalizedIfsc = ifscCode.toString().replace(/\s+/g, '').trim().toUpperCase()

    if (!/^\d{9,18}$/.test(normalizedAccount)) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Invalid accountNumber — must be 9–18 digits' },
          is_valid: false,
          verification_charges: 0,
        },
        { status: 400 }
      )
    }

    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalizedIfsc)) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Invalid ifscCode format (e.g. SBIN0001234)' },
          is_valid: false,
          verification_charges: 0,
        },
        { status: 400 }
      )
    }

    const orderId = generateOrderId('PTNR_VFY')

    let result: Awaited<ReturnType<typeof verifyBankPennyLess>>
    try {
      result = await verifyBankPennyLess(normalizedAccount, normalizedIfsc, orderId)
    } catch (err: any) {
      console.error('[Partner Payout Verify] eKYC Hub call failed:', err.message)
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Account verification service temporarily unavailable. Please try again later.',
          },
          is_valid: false,
          verification_charges: 0,
        },
        { status: 503 }
      )
    }

    if (result.status !== 'Success' || !result.nameAtBank) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: result.message || 'Account validation failed — check account number and IFSC code.',
          },
          is_valid: false,
          verification_charges: 0,
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      is_valid: true,
      account_holder_name: result.nameAtBank,
      bank_name: (body.bankName || '').trim() || normalizedIfsc.substring(0, 4).toUpperCase(),
      branch_name: null,
      verification_charges: 0,
      message: 'Account verified successfully via eKYC Hub',
      reference_id: orderId,
    })
  } catch (error: any) {
    console.error('[Partner Payout Verify] Unhandled error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
