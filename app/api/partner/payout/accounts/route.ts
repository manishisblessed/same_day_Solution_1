/**
 * POST /api/partner/payout/accounts  — Register a new bank account (beneficiary)
 * GET  /api/partner/payout/accounts  — List registered accounts
 * DELETE /api/partner/payout/accounts?id=<bene_id> — Remove account
 *
 * registration_type:
 *   'register' (default) — Knteer add-bene only, ₹4.72, is_bank_verified = false
 *   'verify'             — eKYC Hub penny_less first, Knteer add-bene, ₹4.72, is_bank_verified = true
 *
 * Upgrade path: already-registered (unverified) account + registration_type='verify'
 *   → runs eKYC only (skips Knteer add-bene), charges ₹4.72, marks is_bank_verified = true
 *
 * Already-verified accounts return success immediately with no charge.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { getOrCreateBeneCode } from '@/services/knteer-payout/beneficiary'
import { sendKnteerRegistrationCallback } from '@/lib/knteer-payout-callback'
import { verifyBankPennyLess, generateOrderId } from '@/services/ekyc'
import { isAccountVerificationEnabled, ACCOUNT_VERIFICATION_DISABLED_MESSAGE } from '@/lib/settings/account-verification'

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
      .select('id, account_number, ifsc_code, bene_name, bank_name, mobile, bene_code, is_bank_verified, verified_name_at_bank, created_at')
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
      account_holder_name: a.verified_name_at_bank || a.bene_name,
      bank_name:           a.bank_name || a.ifsc_code?.substring(0, 4),
      mobile:              a.mobile,
      is_registered:       true,
      is_bank_verified:    a.is_bank_verified ?? false,
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

// ── POST — register or verify account ────────────────────────────────────────
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

    const {
      accountNumber,
      ifscCode,
      accountHolderName,
      bankName,
      mobile,
      email,
      registration_type = 'register',  // 'register' | 'verify'
    } = body

    // ── Validate registration_type ────────────────────────────────────────────
    if (!['register', 'verify'].includes(registration_type)) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'registration_type must be "register" or "verify"' } },
        { status: 400 }
      )
    }

    // ── Validate account number ───────────────────────────────────────────────
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

    if (!mobile || !/^[6-9]\d{9}$/.test(String(mobile))) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'mobile must be a 10-digit Indian mobile number' } },
        { status: 400 }
      )
    }

    // accountHolderName required for 'register'; optional for 'verify' (name comes from bank)
    const cleanName = String(accountHolderName || '').trim().replace(/\s+/g, ' ')
    if (registration_type === 'register' && cleanName.length < 3) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'accountHolderName must be at least 3 characters' } },
        { status: 400 }
      )
    }

    const derivedBankName = String(bankName || '').trim() || normalizedIfsc.substring(0, 4).toUpperCase()
    const derivedEmail    = String(email || '').trim() || `${partner.id}@knteer.bene`

    const supabase = getSupabase()

    // ── Check existing beneficiary record ─────────────────────────────────────
    const { data: existing } = await supabase
      .from('knteer_beneficiaries')
      .select('id, bene_code, bene_name, bank_name, is_bank_verified, verified_name_at_bank')
      .eq('retailer_id', partner.id)
      .eq('account_number', normalizedAccount)
      .eq('ifsc_code', normalizedIfsc)
      .eq('is_active', true)
      .maybeSingle()

    // ── Already fully verified — no charge, return immediately ───────────────
    if (existing?.is_bank_verified) {
      return NextResponse.json({
        success: true,
        already_registered: true,
        registration_type: 'verify',
        verification_charge: 0,
        message: 'Account is already registered and bank-verified. No charge applied.',
        account: {
          account_number:      normalizedAccount.replace(/\d(?=\d{4})/g, '*'),
          ifsc_code:           normalizedIfsc,
          account_holder_name: existing.verified_name_at_bank || existing.bene_name || cleanName,
          bank_name:           existing.bank_name || derivedBankName,
          is_registered:       true,
          is_bank_verified:    true,
        },
      })
    }

    // ── Already registered (unverified) + 'register' — return as-is ──────────
    if (existing?.bene_code && registration_type === 'register') {
      return NextResponse.json({
        success: true,
        already_registered: true,
        registration_type: 'register',
        verification_charge: 0,
        message: 'Account is already registered. No charge applied. Use registration_type="verify" to bank-verify this account.',
        account: {
          account_number:      normalizedAccount.replace(/\d(?=\d{4})/g, '*'),
          ifsc_code:           normalizedIfsc,
          account_holder_name: existing.bene_name || cleanName,
          bank_name:           existing.bank_name || derivedBankName,
          is_registered:       true,
          is_bank_verified:    false,
        },
      })
    }

    // ── UPGRADE PATH: registered (unverified) + 'verify' ─────────────────────
    if (existing?.bene_code && registration_type === 'verify') {
      return handleVerifyUpgrade({
        supabase, partner, existing,
        normalizedAccount, normalizedIfsc, derivedBankName,
        BENE_FEE, BENE_FEE_BASE, BENE_FEE_GST,
      })
    }

    // ══════════════════════════════════════════════════════════════════════════
    // NEW REGISTRATION — PATH A ('register') or PATH B ('verify')
    // ══════════════════════════════════════════════════════════════════════════

    // ── Shared: wallet balance + frozen check ─────────────────────────────────
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
          message: `Insufficient balance. Account registration fee is ₹${BENE_FEE} (₹${BENE_FEE_BASE} + ₹${BENE_FEE_GST} GST). Available: ₹${(walletBalance || 0).toFixed(2)}`,
        },
        wallet_balance: walletBalance,
        verification_fee: BENE_FEE,
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

    // ══════════════════════════════════════════════════════════════════════════
    // PATH B — eKYC Hub VERIFICATION first, then Knteer add-bene
    // ══════════════════════════════════════════════════════════════════════════
    if (registration_type === 'verify') {
      // Check global verification toggle
      if (!(await isAccountVerificationEnabled())) {
        return NextResponse.json(
          { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: ACCOUNT_VERIFICATION_DISABLED_MESSAGE } },
          { status: 503 }
        )
      }

      const verifyOrderId = generateOrderId('PTNR_BVFY')
      let ekycResult: Awaited<ReturnType<typeof verifyBankPennyLess>>
      try {
        ekycResult = await verifyBankPennyLess(normalizedAccount, normalizedIfsc, verifyOrderId)
      } catch (ekycErr: any) {
        console.error('[Partner Payout Accounts] eKYC Hub verify call failed:', ekycErr.message)
        return NextResponse.json(
          { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Bank verification service temporarily unavailable. Please try again later.' } },
          { status: 503 }
        )
      }

      if (ekycResult.status !== 'Success' || !ekycResult.nameAtBank) {
        return NextResponse.json({
          success: false,
          error: {
            code: 'BANK_VERIFICATION_FAILED',
            message: ekycResult.message || 'Bank account verification failed. Check account number and IFSC code.',
          },
        }, { status: 400 })
      }

      const verifiedName = ekycResult.nameAtBank
      const verificationUtr = ekycResult.utr || null
      const verifiedAt = new Date().toISOString()

      // Register with Knteer (creates bene_code)
      const knteerResult = await getOrCreateBeneCode(supabase, partner.id, {
        accountNumber: normalizedAccount,
        ifsc:          normalizedIfsc,
        beneName:      verifiedName,
        bankName:      derivedBankName,
        mobile:        String(mobile),
        email:         derivedEmail,
        isBankVerified: true,
        verifiedAt,
        verifiedNameAtBank: verifiedName,
        verificationUtr:    verificationUtr || undefined,
        verificationOrderid: verifyOrderId,
      })

      if (!knteerResult.success || !knteerResult.beneCode) {
        return NextResponse.json({
          success: false,
          error: {
            code: 'REGISTRATION_FAILED',
            message: knteerResult.error || 'Failed to register account with payout provider. No charge applied.',
          },
        }, { status: 502 })
      }

      // Debit fee only after successful Knteer registration
      const refId = `KBENE_VFY_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`
      const debitDesc = `Knteer account verification fee ₹${BENE_FEE} (₹${BENE_FEE_BASE} + ₹${BENE_FEE_GST} GST) — ${normalizedAccount.slice(-4)} / ${normalizedIfsc} [eKYC verified]`
      const { error: debitError } = await (supabase as any).rpc('debit_partner_wallet', {
        p_partner_id:   partner.id,
        p_amount:       BENE_FEE,
        p_description:  debitDesc,
        p_reference_id: refId,
        p_service_type: 'knteer_payout',
      })

      if (debitError) {
        console.error('[Partner Payout Accounts] CRITICAL: Bene verified+registered but wallet debit failed', {
          partnerId: partner.id, refId, error: debitError.message,
        })
      }

      sendKnteerRegistrationCallback(partner.id, {
        partner_trans_id:    refId,
        account_number:      normalizedAccount,
        account_holder_name: verifiedName,
        bank_name:           derivedBankName,
        ifsc_code:           normalizedIfsc,
        verification_charge: BENE_FEE,
      }).catch(() => {})

      return NextResponse.json({
        success: true,
        registration_type: 'verify',
        message: `Account verified and registered. ₹${BENE_FEE} (₹${BENE_FEE_BASE} + ₹${BENE_FEE_GST} GST) charged.`,
        verification_charge: BENE_FEE,
        reference_id: refId,
        account: {
          account_number:      normalizedAccount.replace(/\d(?=\d{4})/g, '*'),
          ifsc_code:           normalizedIfsc,
          account_holder_name: verifiedName,
          bank_name:           derivedBankName,
          is_registered:       true,
          is_bank_verified:    true,
        },
      })
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PATH A — REGISTER (Knteer add-bene only, no eKYC, is_bank_verified = false)
    // ══════════════════════════════════════════════════════════════════════════
    const refId = `KBENE_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`

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

    const debitDesc = `Knteer account registration fee ₹${BENE_FEE} (₹${BENE_FEE_BASE} + ₹${BENE_FEE_GST} GST) — ${normalizedAccount.slice(-4)} / ${normalizedIfsc}`
    const { error: debitError } = await (supabase as any).rpc('debit_partner_wallet', {
      p_partner_id:   partner.id,
      p_amount:       BENE_FEE,
      p_description:  debitDesc,
      p_reference_id: refId,
      p_service_type: 'knteer_payout',
    })

    if (debitError) {
      console.error('[Partner Payout Accounts] CRITICAL: Bene registered but wallet debit failed', {
        partnerId: partner.id, refId, error: debitError.message,
      })
      return NextResponse.json({
        success: true,
        registration_type: 'register',
        message: 'Account registered successfully. Note: fee debit encountered an issue — please contact support.',
        verification_charge: BENE_FEE,
        account: {
          account_number:      normalizedAccount.replace(/\d(?=\d{4})/g, '*'),
          ifsc_code:           normalizedIfsc,
          account_holder_name: cleanName,
          bank_name:           derivedBankName,
          is_registered:       true,
          is_bank_verified:    false,
        },
      }, { status: 207 })
    }

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
      registration_type: 'register',
      message: `Account registered successfully. ₹${BENE_FEE} (₹${BENE_FEE_BASE} + ₹${BENE_FEE_GST} GST) charged.`,
      verification_charge: BENE_FEE,
      reference_id: refId,
      account: {
        account_number:      normalizedAccount.replace(/\d(?=\d{4})/g, '*'),
        ifsc_code:           normalizedIfsc,
        account_holder_name: cleanName,
        bank_name:           derivedBankName,
        is_registered:       true,
        is_bank_verified:    false,
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

// ── UPGRADE HELPER — eKYC verify an already-registered (unverified) account ──
async function handleVerifyUpgrade({
  supabase, partner, existing,
  normalizedAccount, normalizedIfsc, derivedBankName,
  BENE_FEE, BENE_FEE_BASE, BENE_FEE_GST,
}: {
  supabase: ReturnType<typeof getSupabase>
  partner: any
  existing: { id: string; bene_code: string; bene_name: string; bank_name: string; is_bank_verified: boolean; verified_name_at_bank: string | null }
  normalizedAccount: string
  normalizedIfsc: string
  derivedBankName: string
  BENE_FEE: number
  BENE_FEE_BASE: number
  BENE_FEE_GST: number
}): Promise<NextResponse> {
  // Check global verification toggle
  if (!(await isAccountVerificationEnabled())) {
    return NextResponse.json(
      { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: ACCOUNT_VERIFICATION_DISABLED_MESSAGE } },
      { status: 503 }
    )
  }

  // Check wallet balance
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
        message: `Insufficient balance. Verification upgrade fee is ₹${BENE_FEE} (₹${BENE_FEE_BASE} + ₹${BENE_FEE_GST} GST). Available: ₹${(walletBalance || 0).toFixed(2)}`,
      },
      wallet_balance: walletBalance,
      verification_fee: BENE_FEE,
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

  // Run eKYC Hub penny_less
  const upgradeOrderId = generateOrderId('PTNR_UPG')
  let upgradeEkyc: Awaited<ReturnType<typeof verifyBankPennyLess>>
  try {
    upgradeEkyc = await verifyBankPennyLess(normalizedAccount, normalizedIfsc, upgradeOrderId)
  } catch (ekycErr: any) {
    console.error('[Partner Payout Accounts] Upgrade eKYC Hub call failed:', ekycErr.message)
    return NextResponse.json(
      { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Bank verification service temporarily unavailable. Please try again later.' } },
      { status: 503 }
    )
  }

  if (upgradeEkyc.status !== 'Success' || !upgradeEkyc.nameAtBank) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'BANK_VERIFICATION_FAILED',
        message: upgradeEkyc.message || 'Bank account verification failed. Check account number and IFSC code.',
      },
    }, { status: 400 })
  }

  const verifiedName = upgradeEkyc.nameAtBank
  const upgNow = new Date().toISOString()

  // Update the existing DB record
  await supabase
    .from('knteer_beneficiaries')
    .update({
      is_bank_verified:      true,
      verified_at:           upgNow,
      verified_name_at_bank: verifiedName,
      verification_utr:      upgradeEkyc.utr || null,
      verification_orderid:  upgradeOrderId,
      bene_name:             verifiedName,
      updated_at:            upgNow,
    })
    .eq('id', existing.id)

  // Debit fee
  const refId = `KBENE_UPG_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  const { error: debitError } = await (supabase as any).rpc('debit_partner_wallet', {
    p_partner_id:   partner.id,
    p_amount:       BENE_FEE,
    p_description:  `Knteer account verification upgrade ₹${BENE_FEE} (₹${BENE_FEE_BASE} + ₹${BENE_FEE_GST} GST) — ${normalizedAccount.slice(-4)} / ${normalizedIfsc}`,
    p_reference_id: refId,
    p_service_type: 'knteer_payout',
  })

  if (debitError) {
    console.error('[Partner Payout Accounts] CRITICAL: Upgrade verified but wallet debit failed', {
      partnerId: partner.id, refId, error: debitError.message,
    })
  }

  return NextResponse.json({
    success: true,
    registration_type: 'verify',
    message: `Account verified successfully. ₹${BENE_FEE} (₹${BENE_FEE_BASE} + ₹${BENE_FEE_GST} GST) charged.`,
    verification_charge: BENE_FEE,
    reference_id: refId,
    account: {
      account_number:      normalizedAccount.replace(/\d(?=\d{4})/g, '*'),
      ifsc_code:           normalizedIfsc,
      account_holder_name: verifiedName,
      bank_name:           existing.bank_name || derivedBankName,
      is_registered:       true,
      is_bank_verified:    true,
    },
  })
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
