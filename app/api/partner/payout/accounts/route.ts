/**
 * POST /api/partner/payout/accounts  — Register a new bank account (beneficiary)
 * GET  /api/partner/payout/accounts  — List registered accounts
 * DELETE /api/partner/payout/accounts?id=<bene_id> — Remove account
 *
 * Account registration calls Knteer add-bene and charges a one-time
 * verification fee of ₹4 + 18% GST = ₹4.72.
 *
 * Subsequent transfers to the same account are NOT charged this fee.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { getOrCreateBeneCode } from '@/services/knteer-payout/beneficiary'
import { sendKnteerRegistrationCallback } from '@/lib/knteer-payout-callback'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const BENE_FEE_BASE = 4
const BENE_FEE_GST  = Math.round(BENE_FEE_BASE * 18 / 100 * 100) / 100  // 0.72
const BENE_FEE      = BENE_FEE_BASE + BENE_FEE_GST                       // 4.72

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

function authError(e: PartnerAuthError) {
  return NextResponse.json(
    { success: false, error: { code: e.code, message: e.message } },
    { status: e.status }
  )
}

// ── GET — list registered accounts ───────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    let authResult
    try { authResult = await authenticatePartner(request) }
    catch (error) { return authError(error as PartnerAuthError) }

    const { partner } = authResult
    const payoutAccess = partnerCanUseApi(partner, 'payout')
    if (!payoutAccess.allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: payoutAccess.message } },
        { status: 403 }
      )
    }

    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('knteer_beneficiaries')
      .select('id, account_number, ifsc_code, bene_name, bank_name, mobile, bene_code, created_at')
      .eq('retailer_id', partner.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ success: true, accounts: [] })
    }

    const accounts = (data || []).map((a: any) => ({
      id:                  a.id,
      account_number:      (a.account_number as string).replace(/\d(?=\d{4})/g, '*'),
      ifsc_code:           a.ifsc_code,
      account_holder_name: a.bene_name,
      bank_name:           a.bank_name || a.ifsc_code?.substring(0, 4),
      mobile:              a.mobile,
      is_registered:       true,
      created_at:          a.created_at,
    }))

    return NextResponse.json({ success: true, accounts, count: accounts.length })
  } catch (err: any) {
    console.error('[Partner Payout Accounts] GET error:', err)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}

// ── POST — register new account ───────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    let authResult
    try { authResult = await authenticatePartner(request) }
    catch (error) { return authError(error as PartnerAuthError) }

    const { partner } = authResult
    const payoutAccess = partnerCanUseApi(partner, 'payout')
    if (!payoutAccess.allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: payoutAccess.message } },
        { status: 403 }
      )
    }

    let body: any
    try { body = await request.json() }
    catch {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
        { status: 400 }
      )
    }

    const { accountNumber, ifscCode, accountHolderName, bankName, mobile, email } = body

    // ── Validate ─────────────────────────────────────────────────────────────
    if (!accountNumber || String(accountNumber).replace(/\D/g, '').length < 9) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'accountNumber must be at least 9 digits' } },
        { status: 400 }
      )
    }
    const normalizedAccount = String(accountNumber).replace(/\D/g, '').trim()
    if (normalizedAccount.length > 18) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'accountNumber must be at most 18 digits' } },
        { status: 400 }
      )
    }

    const normalizedIfsc = String(ifscCode || '').replace(/\s+/g, '').trim().toUpperCase()
    if (!normalizedIfsc || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalizedIfsc)) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid ifscCode format (e.g. SBIN0001234)' } },
        { status: 400 }
      )
    }

    const cleanName = String(accountHolderName || '').trim().replace(/\s+/g, ' ')
    if (cleanName.length < 3) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'accountHolderName must be at least 3 characters' } },
        { status: 400 }
      )
    }

    if (!mobile || !/^[6-9]\d{9}$/.test(String(mobile))) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'mobile must be a 10-digit Indian mobile number' } },
        { status: 400 }
      )
    }

    const supabase = getSupabase()

    // ── Already registered? ───────────────────────────────────────────────────
    const { data: existing } = await supabase
      .from('knteer_beneficiaries')
      .select('id, bene_code, bene_name, bank_name')
      .eq('retailer_id', partner.id)
      .eq('account_number', normalizedAccount)
      .eq('ifsc_code', normalizedIfsc)
      .eq('is_active', true)
      .maybeSingle()

    if (existing?.bene_code) {
      return NextResponse.json({
        success: true,
        already_registered: true,
        message: 'Account is already registered. No charge applied.',
        verification_charge: 0,
        account: {
          account_number:      normalizedAccount.replace(/\d(?=\d{4})/g, '*'),
          ifsc_code:           normalizedIfsc,
          account_holder_name: existing.bene_name || cleanName,
          bank_name:           existing.bank_name || bankName || normalizedIfsc.substring(0, 4),
          is_registered:       true,
        },
      })
    }

    // ── Wallet balance check — must have ≥ ₹4.72 ─────────────────────────────
    const { data: walletBalance, error: balErr } = await (supabase as any).rpc(
      'get_partner_wallet_balance', { p_partner_id: partner.id }
    )
    if (balErr || walletBalance === null) {
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to check wallet balance' } },
        { status: 500 }
      )
    }
    if ((walletBalance || 0) < BENE_FEE) {
      return NextResponse.json({
        success: false,
        error: {
          code: 'INSUFFICIENT_BALANCE',
          message: `Insufficient balance. Account verification fee is ₹${BENE_FEE} (₹${BENE_FEE_BASE} + ${BENE_FEE_GST} GST). Available: ₹${(walletBalance || 0).toFixed(2)}`,
        },
        wallet_balance: walletBalance,
        verification_fee: BENE_FEE,
      }, { status: 400 })
    }

    // ── Check wallet frozen ───────────────────────────────────────────────────
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

    const derivedBankName = String(bankName || '').trim() || normalizedIfsc.substring(0, 4).toUpperCase()
    const derivedEmail    = String(email || '').trim() || `${partner.id}@knteer.bene`
    const refId           = `KBENE_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`

    // ── Register with Knteer ─────────────────────────────────────────────────
    const result = await getOrCreateBeneCode(supabase, partner.id, {
      accountNumber: normalizedAccount,
      ifsc:          normalizedIfsc,
      beneName:      cleanName,
      bankName:      derivedBankName,
      mobile:        String(mobile),
      email:         derivedEmail,
    })

    if (!result.success || !result.beneCode) {
      return NextResponse.json({
        success: false,
        error: {
          code: 'REGISTRATION_FAILED',
          message: result.error || 'Failed to register account with Knteer. Check account details and try again.',
        },
      }, { status: 502 })
    }

    // ── Debit ₹4.72 verification fee ─────────────────────────────────────────
    const debitDesc = `Knteer account verification fee ₹${BENE_FEE} (₹${BENE_FEE_BASE} + ₹${BENE_FEE_GST} GST) — ${normalizedAccount.slice(-4)} / ${normalizedIfsc}`
    const { error: debitError } = await (supabase as any).rpc('debit_partner_wallet', {
      p_partner_id:   partner.id,
      p_amount:       BENE_FEE,
      p_description:  debitDesc,
      p_reference_id: refId,
      p_service_type: 'knteer_payout',
    })

    if (debitError) {
      // Registration succeeded but debit failed — log for manual review
      console.error('[Partner Payout Accounts] CRITICAL: Bene registered but wallet debit failed', {
        partnerId: partner.id, refId, error: debitError.message,
      })
      // Still return success for registration, note the billing issue
      return NextResponse.json({
        success: true,
        message: 'Account registered successfully. Note: verification fee debit encountered an issue — please contact support.',
        verification_charge: BENE_FEE,
        account: {
          account_number:      normalizedAccount.replace(/\d(?=\d{4})/g, '*'),
          ifsc_code:           normalizedIfsc,
          account_holder_name: cleanName,
          bank_name:           derivedBankName,
          is_registered:       true,
        },
      }, { status: 207 })
    }

    // ── Fire webhook callback ─────────────────────────────────────────────────
    sendKnteerRegistrationCallback(partner.id, {
      partner_trans_id:    refId,
      account_number:      normalizedAccount,
      account_holder_name: cleanName,
      bank_name:           derivedBankName,
      ifsc_code:           normalizedIfsc,
      verification_charge: BENE_FEE,
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      message: `Account registered successfully. Verification fee of ₹${BENE_FEE} (₹${BENE_FEE_BASE} + ₹${BENE_FEE_GST} GST) charged.`,
      verification_charge: BENE_FEE,
      reference_id: refId,
      account: {
        account_number:      normalizedAccount.replace(/\d(?=\d{4})/g, '*'),
        ifsc_code:           normalizedIfsc,
        account_holder_name: cleanName,
        bank_name:           derivedBankName,
        is_registered:       true,
      },
    })
  } catch (err: any) {
    console.error('[Partner Payout Accounts] POST error:', err)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}

// ── DELETE — remove account ───────────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  try {
    let authResult
    try { authResult = await authenticatePartner(request) }
    catch (error) { return authError(error as PartnerAuthError) }

    const { partner } = authResult
    const payoutAccess = partnerCanUseApi(partner, 'payout')
    if (!payoutAccess.allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: payoutAccess.message } },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'id query parameter is required' } },
        { status: 400 }
      )
    }

    const supabase = getSupabase()
    const { error } = await supabase
      .from('knteer_beneficiaries')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('retailer_id', partner.id)

    if (error) {
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, message: 'Account removed successfully.' })
  } catch (err: any) {
    console.error('[Partner Payout Accounts] DELETE error:', err)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
