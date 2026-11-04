/**
 * /api/knteer-payout/accounts
 *
 * Manages saved beneficiary accounts for Settlement-1 (Knteer).
 *
 * GET    — list accounts for the current user
 * POST   — register or verify account
 *            registration_type = 'register' → Free, no eKYC, disclaimer required
 *            registration_type = 'verify'   → ₹4 + 18% GST via eKYC Penny Less
 * DELETE — remove account (?id=<uuid>)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { normalizeMasterPartner } from '@/lib/partner-access'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getOrCreateBeneCode } from '@/services/knteer-payout/beneficiary'
import { verifyBankPennyLess, generateOrderId } from '@/services/ekyc'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CHARGE_BASE = 4.00
const CHARGE_GST = Math.round(CHARGE_BASE * 18 / 100 * 100) / 100  // 0.72
const VERIFICATION_FEE = Math.round((CHARGE_BASE + CHARGE_GST) * 100) / 100 // ₹4.72

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function OPTIONS(request: NextRequest) {
  const res = handleCorsPreflight(request)
  return res || new NextResponse(null, { status: 204 })
}

// ── GET — list accounts ───────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    normalizeMasterPartner(user)

    if (!user?.partner_id) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 }))
    }
    if (!['retailer', 'partner', 'admin'].includes(user.role || '')) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 }))
    }

    const { data, error } = await supabaseAdmin
      .from('knteer_beneficiaries')
      .select('id, account_number, ifsc_code, bene_name, bank_name, mobile, email, bene_code, is_active, is_bank_verified, verified_name_at_bank, disclaimer_accepted, created_at')
      .eq('retailer_id', user.partner_id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[Knteer Accounts] List error:', error.message)
      return addCorsHeaders(request, NextResponse.json({ success: true, accounts: [] }))
    }

    const accounts = (data || []).map(a => ({
      id: a.id,
      account_number: a.account_number,
      ifsc_code: a.ifsc_code,
      account_holder_name: a.verified_name_at_bank || a.bene_name,
      bank_name: a.bank_name || a.ifsc_code?.substring(0, 4),
      bene_code: a.bene_code,
      mobile: a.mobile,
      is_registered: true,
      is_bank_verified: a.is_bank_verified ?? false,
      disclaimer_accepted: a.disclaimer_accepted ?? false,
      created_at: a.created_at,
    }))

    return addCorsHeaders(request, NextResponse.json({ success: true, accounts }))
  } catch (err: any) {
    console.error('[Knteer Accounts] GET error:', err)
    return addCorsHeaders(request, NextResponse.json({ success: false, error: err.message }, { status: 500 }))
  }
}

// ── POST — register or verify account ────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    normalizeMasterPartner(user)

    if (!user?.partner_id) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 }))
    }
    if (!['retailer', 'partner'].includes(user.role || '')) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 }))
    }

    const body = await request.json()
    const {
      account_number,
      ifsc_code,
      account_holder_name,
      bank_name,
      mobile,
      email,
      registration_type = 'register',   // 'register' | 'verify'
      disclaimer_accepted = false,
    } = body

    // ── Shared validation ──────────────────────────────────────────────────
    if (!account_number || account_number.length < 9) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Enter a valid account number (min 9 digits)' }, { status: 400 }))
    }
    if (!ifsc_code || !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(ifsc_code)) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Enter a valid IFSC code (e.g. SBIN0001234)' }, { status: 400 }))
    }
    if (!mobile || !/^[6-9]\d{9}$/.test(String(mobile))) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Enter a valid 10-digit mobile number' }, { status: 400 }))
    }

    const cleanIfsc = ifsc_code.toUpperCase()
    const derivedBankName = bank_name?.trim() || cleanIfsc.substring(0, 4).toUpperCase()
    const derivedEmail = email?.trim() || `${user.partner_id}@knteer.bene`

    // ── Registration type validation ───────────────────────────────────────
    if (!['register', 'verify'].includes(registration_type)) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Invalid registration_type. Use "register" or "verify".' }, { status: 400 }))
    }

    // For free registration — name is required (no bank to confirm it)
    if (registration_type === 'register') {
      const cleanName = (account_holder_name || '').trim().replace(/\s+/g, ' ')
      if (cleanName.length < 3) {
        return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Account holder name must be at least 3 characters' }, { status: 400 }))
      }
      if (!disclaimer_accepted) {
        return addCorsHeaders(request, NextResponse.json({ success: false, error: 'You must accept the disclaimer to register an unverified account.' }, { status: 400 }))
      }
    }

    // ── Check for existing account ─────────────────────────────────────────
    const { data: existing } = await supabaseAdmin
      .from('knteer_beneficiaries')
      .select('id, bene_code, bene_name, is_bank_verified, verified_name_at_bank')
      .eq('retailer_id', user.partner_id)
      .eq('account_number', account_number)
      .eq('ifsc_code', cleanIfsc)
      .eq('is_active', true)
      .maybeSingle()

    // If already verified — no need to re-register
    if (existing?.is_bank_verified) {
      return addCorsHeaders(request, NextResponse.json({
        success: true,
        already_exists: true,
        message: 'This account is already registered and bank-verified.',
        account: {
          id: existing.id,
          account_number,
          ifsc_code: cleanIfsc,
          account_holder_name: existing.verified_name_at_bank || existing.bene_name,
          bene_code: existing.bene_code,
          is_registered: true,
          is_bank_verified: true,
        },
      }))
    }

    // If already registered (unverified) and user is trying to register again (not verify) — skip
    if (existing?.bene_code && registration_type === 'register') {
      return addCorsHeaders(request, NextResponse.json({
        success: true,
        already_exists: true,
        message: 'This account is already registered.',
        account: {
          id: existing.id,
          account_number,
          ifsc_code: cleanIfsc,
          account_holder_name: existing.bene_name,
          bene_code: existing.bene_code,
          is_registered: true,
          is_bank_verified: false,
        },
      }))
    }

    // ══════════════════════════════════════════════════════════════════════
    // PATH A — FREE REGISTRATION (no eKYC, disclaimer required)
    // ══════════════════════════════════════════════════════════════════════
    if (registration_type === 'register') {
      const cleanName = (account_holder_name || '').trim().replace(/\s+/g, ' ')
      const now = new Date().toISOString()

      const result = await getOrCreateBeneCode(supabaseAdmin, user.partner_id, {
        accountNumber: account_number,
        ifsc: cleanIfsc,
        beneName: cleanName,
        bankName: derivedBankName,
        mobile: String(mobile),
        email: derivedEmail,
        isBankVerified: false,
        disclaimerAccepted: true,
        disclaimerAcceptedAt: now,
      })

      if (!result.success || !result.beneCode) {
        return addCorsHeaders(request, NextResponse.json({
          success: false,
          error: result.error || 'Failed to register account. Please try again.',
        }, { status: 502 }))
      }

      const { data: saved } = await supabaseAdmin
        .from('knteer_beneficiaries')
        .select('id, account_number, ifsc_code, bene_name, bank_name, bene_code, is_bank_verified, created_at')
        .eq('retailer_id', user.partner_id)
        .eq('account_number', account_number)
        .eq('ifsc_code', cleanIfsc)
        .maybeSingle()

      return addCorsHeaders(request, NextResponse.json({
        success: true,
        registration_type: 'register',
        charge_deducted: 0,
        message: 'Account registered successfully (unverified). No charges applied.',
        account: {
          id: saved?.id,
          account_number,
          ifsc_code: cleanIfsc,
          account_holder_name: cleanName,
          bank_name: derivedBankName,
          bene_code: result.beneCode,
          is_registered: true,
          is_bank_verified: false,
        },
      }))
    }

    // ══════════════════════════════════════════════════════════════════════
    // PATH B — PAID VERIFICATION via eKYC Penny Less (₹4.72)
    // ══════════════════════════════════════════════════════════════════════

    // Step 1 — eKYC Penny Less: verify the bank account FIRST (before charging)
    const verifyOrderId = generateOrderId('KNTEER_VFY')
    let ekycResult: Awaited<ReturnType<typeof verifyBankPennyLess>>
    try {
      ekycResult = await verifyBankPennyLess(account_number, cleanIfsc, verifyOrderId)
    } catch (ekycErr: any) {
      console.error('[Knteer Accounts] eKYC call failed:', ekycErr.message)
      return addCorsHeaders(request, NextResponse.json({
        success: false,
        error: 'Bank verification service is temporarily unavailable. Please try again later.',
      }, { status: 503 }))
    }

    if (ekycResult.status !== 'Success' || !ekycResult.nameAtBank) {
      return addCorsHeaders(request, NextResponse.json({
        success: false,
        error: ekycResult.message || 'Bank account verification failed. Please check the account number and IFSC code.',
        error_code: 'BANK_VERIFICATION_FAILED',
      }, { status: 400 }))
    }

    const verifiedName = ekycResult.nameAtBank
    const verificationUtr = ekycResult.utr || null
    const verifiedAt = new Date().toISOString()

    // Step 2 — Check wallet balance before charging
    let walletBalance = 0
    let balanceError: any = null
    if (user.role === 'partner') {
      const { data, error } = await (supabaseAdmin as any).rpc('get_partner_wallet_balance', { p_partner_id: user.partner_id })
      walletBalance = data || 0; balanceError = error
    } else {
      const { data, error } = await (supabaseAdmin as any).rpc('get_wallet_balance_v2', { p_user_id: user.partner_id, p_wallet_type: 'primary' })
      walletBalance = data || 0; balanceError = error
    }
    if (balanceError) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Failed to check wallet balance' }, { status: 500 }))
    }
    if (walletBalance < VERIFICATION_FEE) {
      return addCorsHeaders(request, NextResponse.json({
        success: false,
        error: `Insufficient wallet balance. Verification fee is ₹${VERIFICATION_FEE} (₹${CHARGE_BASE} + 18% GST). Current balance: ₹${walletBalance}`,
        wallet_balance: walletBalance,
        required: VERIFICATION_FEE,
      }, { status: 400 }))
    }

    // Step 3 — Debit verification fee from user wallet
    const refId = `K1_VFY_${user.partner_id}_${Date.now()}`
    let chargeLedgerId: string | null = null
    let chargeError: any = null
    if (user.role === 'partner') {
      const { data, error } = await (supabaseAdmin as any).rpc('debit_partner_wallet', {
        p_partner_id: user.partner_id,
        p_amount: VERIFICATION_FEE,
        p_description: `Settlement-1 bank verification fee ₹${VERIFICATION_FEE} for ${account_number} (${cleanIfsc})`,
        p_reference_id: refId,
        p_service_type: 'knteer_payout',
      })
      chargeLedgerId = data; chargeError = error
    } else {
      const { data, error } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
        p_user_id: user.partner_id,
        p_user_role: user.role,
        p_wallet_type: 'primary',
        p_fund_category: 'service',
        p_service_type: 'knteer_payout',
        p_tx_type: 'ACCOUNT_VERIFICATION_CHARGE',
        p_credit: 0,
        p_debit: VERIFICATION_FEE,
        p_reference_id: refId,
        p_transaction_id: null,
        p_status: 'completed',
        p_remarks: `Settlement-1 bank verification fee ₹${VERIFICATION_FEE} (₹${CHARGE_BASE} + 18% GST) for ${account_number} (${cleanIfsc})`,
      })
      chargeLedgerId = data; chargeError = error
    }
    if (chargeError) {
      console.error('[Knteer Accounts] Charge debit error:', chargeError)
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Failed to debit verification fee. Please try again.' }, { status: 500 }))
    }

    // Step 4 — Credit to company revenue
    const revenueUserId = process.env.SUBSCRIPTION_REVENUE_USER_ID
    const revenueUserRole = process.env.SUBSCRIPTION_REVENUE_USER_ROLE || 'master_distributor'
    let revenueLedgerId: string | null = null
    if (revenueUserId) {
      const { data: revId, error: revErr } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
        p_user_id: revenueUserId,
        p_user_role: revenueUserRole,
        p_wallet_type: 'primary',
        p_fund_category: 'revenue',
        p_service_type: 'knteer_payout',
        p_tx_type: 'COMPANY_REVENUE',
        p_credit: VERIFICATION_FEE,
        p_debit: 0,
        p_reference_id: `REV_${refId}`,
        p_transaction_id: null,
        p_status: 'completed',
        p_remarks: `Settlement-1 verification revenue ₹${VERIFICATION_FEE} from ${user.partner_id}`,
      })
      if (!revErr) revenueLedgerId = revId
      else console.error('[Knteer Accounts] Revenue credit error:', revErr)
    }

    // Helper: refund on failure
    const refundFee = async (reason: string) => {
      const refundRef = `REFUND_${refId}`
      if (user.role === 'partner') {
        await (supabaseAdmin as any).rpc('credit_partner_wallet', {
          p_partner_id: user.partner_id, p_amount: VERIFICATION_FEE,
          p_description: `Refund: ${reason}`, p_reference_id: refundRef,
          p_transaction_type: 'REFUND', p_service_type: 'knteer_payout',
        }).catch((e: any) => console.error('[Knteer Accounts] Partner refund failed:', e))
      } else {
        await (supabaseAdmin as any).rpc('add_ledger_entry', {
          p_user_id: user.partner_id, p_user_role: user.role,
          p_wallet_type: 'primary', p_fund_category: 'service',
          p_service_type: 'knteer_payout', p_tx_type: 'ACCOUNT_VERIFICATION_REFUND',
          p_credit: VERIFICATION_FEE, p_debit: 0,
          p_reference_id: refundRef, p_transaction_id: null, p_status: 'completed',
          p_remarks: `Refund: ${reason} for ${account_number} (${cleanIfsc})`,
        }).catch((e: any) => console.error('[Knteer Accounts] Refund failed:', e))
      }
      if (revenueLedgerId && revenueUserId) {
        await (supabaseAdmin as any).rpc('add_ledger_entry', {
          p_user_id: revenueUserId, p_user_role: revenueUserRole,
          p_wallet_type: 'primary', p_fund_category: 'revenue',
          p_service_type: 'knteer_payout', p_tx_type: 'REVENUE_REVERSAL',
          p_credit: 0, p_debit: VERIFICATION_FEE,
          p_reference_id: `REV_REFUND_${refId}`, p_transaction_id: null, p_status: 'completed',
          p_remarks: `Reversal: ${reason} for ${account_number}`,
        }).catch((e: any) => console.error('[Knteer Accounts] Revenue reversal failed:', e))
      }
    }

    // Step 5 — Register with Knteer (get beneCode)
    const result = await getOrCreateBeneCode(supabaseAdmin, user.partner_id, {
      accountNumber: account_number,
      ifsc: cleanIfsc,
      beneName: verifiedName,             // bank-confirmed name from eKYC
      bankName: derivedBankName,
      mobile: String(mobile),
      email: derivedEmail,
      isBankVerified: true,
      verifiedAt,
      verifiedNameAtBank: verifiedName,
      verificationUtr: verificationUtr || undefined,
      verificationOrderid: verifyOrderId,
    })

    if (!result.success || !result.beneCode) {
      await refundFee(`Knteer registration failed: ${result.error || 'unknown error'}`)
      return addCorsHeaders(request, NextResponse.json({
        success: false,
        error: `${result.error || 'Failed to register account with provider'}. Your ₹${VERIFICATION_FEE} fee has been refunded.`,
      }, { status: 502 }))
    }

    // Step 6 — Fetch saved record
    const { data: saved, error: savedErr } = await supabaseAdmin
      .from('knteer_beneficiaries')
      .select('id, account_number, ifsc_code, bene_name, bank_name, bene_code, is_bank_verified, verified_name_at_bank, created_at')
      .eq('retailer_id', user.partner_id)
      .eq('account_number', account_number)
      .eq('ifsc_code', cleanIfsc)
      .maybeSingle()

    if (savedErr || !saved) {
      await refundFee('DB save failed after registration')
      return addCorsHeaders(request, NextResponse.json({
        success: false,
        error: 'Account registered but could not be saved. Your fee has been refunded.',
      }, { status: 500 }))
    }

    return addCorsHeaders(request, NextResponse.json({
      success: true,
      registration_type: 'verify',
      charge_deducted: VERIFICATION_FEE,
      charge_base: CHARGE_BASE,
      charge_gst: CHARGE_GST,
      message: `Account verified successfully. ₹${VERIFICATION_FEE} (₹${CHARGE_BASE} + 18% GST) deducted from wallet.`,
      account: {
        id: saved.id,
        account_number,
        ifsc_code: cleanIfsc,
        account_holder_name: verifiedName,
        bank_name: derivedBankName,
        bene_code: result.beneCode,
        is_registered: true,
        is_bank_verified: true,
      },
    }))
  } catch (err: any) {
    console.error('[Knteer Accounts] POST error:', err)
    return addCorsHeaders(request, NextResponse.json({ success: false, error: err.message }, { status: 500 }))
  }
}

// ── DELETE — remove account ───────────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    normalizeMasterPartner(user)

    if (!user?.partner_id) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 }))
    }

    const id = new URL(request.url).searchParams.get('id')
    if (!id) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'id required' }, { status: 400 }))
    }

    const { error } = await supabaseAdmin
      .from('knteer_beneficiaries')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('retailer_id', user.partner_id)

    if (error) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: error.message }, { status: 500 }))
    }

    return addCorsHeaders(request, NextResponse.json({ success: true }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ success: false, error: err.message }, { status: 500 }))
  }
}
