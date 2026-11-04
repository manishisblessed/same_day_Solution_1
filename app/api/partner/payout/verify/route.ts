/**
 * POST /api/partner/payout/verify
 *
 * Penny-drop account verification via eKYC Hub (penny-less endpoint).
 * Charges ₹4 + 18% GST = ₹4.72 per successful verification.
 *
 * Returns the bank-verified account holder name so the partner can
 * confirm account details before registering via POST /accounts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { verifyBankPennyLess, generateOrderId } from '@/services/ekyc'
import { isAccountVerificationEnabled, ACCOUNT_VERIFICATION_DISABLED_MESSAGE } from '@/lib/settings/account-verification'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const VERIFY_FEE_BASE = 4
const VERIFY_FEE_GST  = Math.round(VERIFY_FEE_BASE * 18 / 100 * 100) / 100  // 0.72
const VERIFY_FEE      = VERIFY_FEE_BASE + VERIFY_FEE_GST                    // 4.72

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

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

    const supabase = getSupabase()

    // ── Check wallet balance ───────────────────────────────────────────────────
    const { data: walletBalance, error: balErr } = await (supabase as any).rpc(
      'get_partner_wallet_balance', { p_partner_id: partner.id }
    )
    if (balErr || walletBalance === null) {
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to check wallet balance' } },
        { status: 500 }
      )
    }
    if ((walletBalance || 0) < VERIFY_FEE) {
      return NextResponse.json({
        success: false,
        error: {
          code: 'INSUFFICIENT_BALANCE',
          message: `Insufficient balance. Account verification fee is ₹${VERIFY_FEE} (₹${VERIFY_FEE_BASE} + ₹${VERIFY_FEE_GST} GST). Available: ₹${(walletBalance || 0).toFixed(2)}`,
        },
        wallet_balance: walletBalance,
        verification_fee: VERIFY_FEE,
      }, { status: 400 })
    }

    const { data: walletInfo } = await supabase
      .from('partner_wallets')
      .select('is_frozen, freeze_reason')
      .eq('partner_id', partner.id)
      .maybeSingle()
    if (walletInfo?.is_frozen) {
      return NextResponse.json(
        { success: false, error: { code: 'WALLET_FROZEN', message: `Wallet is frozen: ${walletInfo.freeze_reason || 'Contact admin'}` } },
        { status: 403 }
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

    // ── Debit verification fee after successful eKYC ───────────────────────────
    const refId = `KPAY_VFY_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`
    const debitDesc = `Account verification fee ₹${VERIFY_FEE} (₹${VERIFY_FEE_BASE} + ₹${VERIFY_FEE_GST} GST) — ${normalizedAccount.slice(-4)} / ${normalizedIfsc} [eKYC penny-less]`
    const { error: debitError } = await (supabase as any).rpc('debit_partner_wallet', {
      p_partner_id:   partner.id,
      p_amount:       VERIFY_FEE,
      p_description:  debitDesc,
      p_reference_id: refId,
      p_service_type: 'knteer_payout',
    })

    if (debitError) {
      console.error('[Partner Payout Verify] CRITICAL: eKYC verified but wallet debit failed', {
        partnerId: partner.id, refId, error: debitError.message,
      })
      // Verification succeeded — still return success; debit failure logged for reconciliation
    }

    return NextResponse.json({
      success: true,
      is_valid: true,
      account_holder_name: result.nameAtBank,
      bank_name: (body.bankName || '').trim() || normalizedIfsc.substring(0, 4).toUpperCase(),
      branch_name: null,
      verification_charges: VERIFY_FEE,
      verification_charges_detail: `₹${VERIFY_FEE_BASE} + ₹${VERIFY_FEE_GST} GST`,
      message: `Account verified successfully via eKYC Hub. ₹${VERIFY_FEE} charged.`,
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
