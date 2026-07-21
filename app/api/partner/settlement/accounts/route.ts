import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { verifyAccount, getVerificationBalance } from '@/services/shadval-pay'
import { isAccountVerificationEnabled, ACCOUNT_VERIFICATION_DISABLED_MESSAGE } from '@/lib/settings/account-verification'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const VERIFICATION_CHARGE = 4.00

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

/**
 * GET /api/partner/settlement/accounts
 * List verified settlement accounts for the partner
 */
export async function GET(request: NextRequest) {
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
    const access = partnerCanUseApi(partner, 'settlement')
    if (!access.allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: access.message } },
        { status: 403 }
      )
    }

    const supabase = getSupabase()

    const { data: accounts, error } = await supabase
      .from('shadval_settlement_accounts')
      .select('id, account_number, ifsc_code, account_holder_name, is_verified, verification_status, verified_name, contact_name, contact_email, contact_mobile, created_at')
      .eq('retailer_id', partner.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch accounts' } },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      accounts: (accounts || []).map((a) => ({
        id: a.id,
        account_number: a.account_number,
        ifsc_code: a.ifsc_code,
        account_holder_name: a.account_holder_name,
        is_verified: a.is_verified,
        verification_status: a.is_verified ? 'VERIFIED' : (a.verification_status || 'NOT_VERIFIED'),
        verification_label: a.is_verified ? 'Verified' : 'Account not verified',
        verified_name: a.verified_name,
        contact_name: a.contact_name,
        contact_email: a.contact_email,
        contact_mobile: a.contact_mobile,
        created_at: a.created_at,
      })),
      count: accounts?.length || 0,
    })
  } catch (error: any) {
    console.error('[Partner Settlement Accounts GET] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}

/**
 * POST /api/partner/settlement/accounts
 * Add & verify a bank account via penny drop (Rs.1 transfer)
 * Charges Rs.4 verification fee from partner wallet
 */
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
    const access = partnerCanUseApi(partner, 'settlement')
    if (!access.allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: access.message } },
        { status: 403 }
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

    const { account_number, ifsc_code, account_holder_name, contact_name, contact_email, contact_mobile, skip_verification } = body

    // Globally disabled by admin (e.g. upstream verification provider outage).
    // Returned before any wallet debit so the partner is never charged.
    // The skip_verification path does not use the verification provider, so it is exempt.
    if (skip_verification !== true && !(await isAccountVerificationEnabled())) {
      return NextResponse.json(
        { success: false, error: { code: 'VERIFICATION_DISABLED', message: ACCOUNT_VERIFICATION_DISABLED_MESSAGE } },
        { status: 503 }
      )
    }

    if (!account_number || !ifsc_code || !account_holder_name) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'account_number, ifsc_code, and account_holder_name are required' } },
        { status: 400 }
      )
    }

    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(ifsc_code)) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid IFSC code format' } },
        { status: 400 }
      )
    }

    const supabase = getSupabase()

    // Check if account already exists and is verified
    const { data: existing } = await supabase
      .from('shadval_settlement_accounts')
      .select('id, is_verified, is_active')
      .eq('retailer_id', partner.id)
      .eq('account_number', account_number)
      .eq('ifsc_code', ifsc_code.toUpperCase())
      .maybeSingle()

    if (existing?.is_verified && existing?.is_active) {
      return NextResponse.json(
        { success: false, error: { code: 'DUPLICATE', message: 'This account is already verified and active' } },
        { status: 400 }
      )
    }

    // ─── SKIP VERIFICATION: Add a trusted account without penny drop ──────
    // Opt-in via skip_verification:true. No penny drop, no ₹4 charge. The account
    // is saved as unverified; transfers to it are at the partner's own risk.
    if (skip_verification === true) {
      if (!contact_mobile || !/^\d{10}$/.test(contact_mobile)) {
        return NextResponse.json(
          { success: false, error: { code: 'BAD_REQUEST', message: 'A valid 10-digit contact_mobile is required' } },
          { status: 400 }
        )
      }

      const skipData = {
        retailer_id: partner.id,
        account_number,
        ifsc_code: ifsc_code.toUpperCase(),
        account_holder_name: account_holder_name.trim(),
        is_verified: false,
        verification_status: 'SKIPPED',
        verification_charges: 0,
        contact_name: contact_name || null,
        contact_email: contact_email || null,
        contact_mobile,
        is_active: true,
      }
      const skipBasicData: Record<string, any> = {
        retailer_id: partner.id,
        account_number,
        ifsc_code: ifsc_code.toUpperCase(),
        account_holder_name: account_holder_name.trim(),
        is_verified: false,
        is_active: true,
      }

      let skipRecord: any = null
      let skipErr: any = null
      if (existing) {
        const { data, error } = await supabase
          .from('shadval_settlement_accounts').update(skipData).eq('id', existing.id).select().single()
        if (error?.code === 'PGRST204') {
          const r = await supabase.from('shadval_settlement_accounts').update(skipBasicData).eq('id', existing.id).select().single()
          skipRecord = r.data; skipErr = r.error
        } else { skipRecord = data; skipErr = error }
      } else {
        const { data, error } = await supabase
          .from('shadval_settlement_accounts').insert(skipData).select().single()
        if (error?.code === 'PGRST204') {
          const r = await supabase.from('shadval_settlement_accounts').insert(skipBasicData).select().single()
          skipRecord = r.data; skipErr = r.error
        } else { skipRecord = data; skipErr = error }
      }

      if (skipErr || !skipRecord) {
        console.error('[Partner Settlement Accounts POST] Skip-verification DB error:', skipErr)
        return NextResponse.json(
          { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to save account' } },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        verified: false,
        verification_status: 'SKIPPED',
        account: {
          id: skipRecord.id,
          account_number: skipRecord.account_number,
          ifsc_code: skipRecord.ifsc_code,
          account_holder_name: skipRecord.account_holder_name,
          is_verified: false,
          verified_name: null,
        },
        charge_deducted: 0,
        skip_verification: true,
        message: 'Account added without verification. Transfers to this account are at your own risk.',
      })
    }

    // Check partner wallet balance
    const { data: walletBalance, error: balErr } = await supabase.rpc('get_partner_wallet_balance', {
      p_partner_id: partner.id
    })

    if (balErr || walletBalance === null || walletBalance === undefined) {
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to check wallet balance' } },
        { status: 500 }
      )
    }

    if (walletBalance < VERIFICATION_CHARGE) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'INSUFFICIENT_BALANCE', message: `Insufficient balance. Verification charge: ₹${VERIFICATION_CHARGE}. Available: ₹${walletBalance}` },
          wallet_balance: walletBalance,
          required: VERIFICATION_CHARGE,
        },
        { status: 400 }
      )
    }

    const refId = `PSV2_VERIFY_${partner.id}_${Date.now()}`

    // Pre-flight: check verification wallet balance
    const balanceCheck = await getVerificationBalance()
    if (balanceCheck.status !== 'SUCCESS') {
      return NextResponse.json(
        { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Verification service is currently unavailable. Please try again later.' } },
        { status: 503 }
      )
    }

    // Debit verification charge from partner wallet
    const { data: ledgerId, error: ledgerErr } = await supabase.rpc('debit_partner_wallet', {
      p_partner_id: partner.id,
      p_amount: VERIFICATION_CHARGE,
      p_payout_transaction_id: null,
      p_description: `Account verification charge ₹${VERIFICATION_CHARGE} for ${account_number} (${ifsc_code})`,
      p_reference_id: refId,
    })

    if (ledgerErr) {
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to debit verification charge' } },
        { status: 500 }
      )
    }

    // Initiate penny-drop verification via Shadval Pay
    const apiResult = await verifyAccount({
      account_number,
      ifsc_code: ifsc_code.toUpperCase(),
      ref_num: refId,
      latitude: '28.6139',
      longitude: '77.2090',
    })

    // Refund if service is unavailable
    const isServiceUnavailable = apiResult.code === 'NETWORK_ERROR' || (!apiResult.status && !apiResult.code)
    if (isServiceUnavailable) {
      try {
        await supabase.rpc('refund_partner_wallet', {
          p_partner_id: partner.id,
          p_amount: VERIFICATION_CHARGE,
          p_payout_transaction_id: null,
          p_description: `Refund: Verification service unavailable for ${account_number}`,
          p_reference_id: `REFUND_${refId}`,
        })
      } catch {}

      return NextResponse.json(
        {
          success: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: 'Verification service unavailable. ₹4 has been refunded.' },
          refunded: true,
        },
        { status: 503 }
      )
    }

    const isSuccess = apiResult.status === 'SUCCESS' && apiResult.data?.verification_status === true
    const verifiedName = apiResult.data?.name_at_bank?.trim() || null
    const verificationStatus = isSuccess ? 'SUCCESS' : apiResult.status === 'PENDING' ? 'PENDING' : 'FAILED'

    // Save/update account record
    const accountData = {
      retailer_id: partner.id,
      account_number,
      ifsc_code: ifsc_code.toUpperCase(),
      account_holder_name: account_holder_name.trim(),
      is_verified: isSuccess,
      verification_ref_id: refId,
      verification_order_id: apiResult.data?.order_id || null,
      verification_status: verificationStatus,
      verification_charges: VERIFICATION_CHARGE,
      verification_ledger_id: ledgerId,
      verified_name: verifiedName,
      verified_at: isSuccess ? new Date().toISOString() : null,
      contact_name: contact_name || null,
      contact_email: contact_email || null,
      contact_mobile: contact_mobile || null,
      is_active: true,
    }

    let accountRecord: any = null
    if (existing) {
      const { data, error } = await supabase
        .from('shadval_settlement_accounts')
        .update(accountData)
        .eq('id', existing.id)
        .select()
        .single()
      if (!error) accountRecord = data
    } else {
      const { data, error } = await supabase
        .from('shadval_settlement_accounts')
        .insert(accountData)
        .select()
        .single()
      if (!error) accountRecord = data
    }

    return NextResponse.json({
      success: true,
      verified: isSuccess,
      verification_status: verificationStatus,
      account: accountRecord ? {
        id: accountRecord.id,
        account_number: accountRecord.account_number,
        ifsc_code: accountRecord.ifsc_code,
        account_holder_name: accountRecord.account_holder_name,
        is_verified: accountRecord.is_verified,
        verified_name: verifiedName,
      } : null,
      verified_name: verifiedName,
      charge_deducted: VERIFICATION_CHARGE,
      message: apiResult.message,
    })
  } catch (error: any) {
    console.error('[Partner Settlement Accounts POST] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/partner/settlement/accounts?id=xxx
 * Deactivate (soft delete) a settlement account
 */
export async function DELETE(request: NextRequest) {
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
    const access = partnerCanUseApi(partner, 'settlement')
    if (!access.allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: access.message } },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const accountId = searchParams.get('id')

    if (!accountId) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Account id query parameter is required' } },
        { status: 400 }
      )
    }

    const supabase = getSupabase()
    const { error } = await supabase
      .from('shadval_settlement_accounts')
      .update({ is_active: false })
      .eq('id', accountId)
      .eq('retailer_id', partner.id)

    if (error) {
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to deactivate account' } },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, message: 'Account deactivated' })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
