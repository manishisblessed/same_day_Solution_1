import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { initiateKnteerTransfer, generateRefId, getKnteerBalance } from '@/services/knteer-payout'
import { refundKnteerPayout } from '@/lib/knteer/refund'
import {
  reserveIdempotencyKey,
  finalizeIdempotencyKey,
  getIdempotencyKeyFromHeaders,
} from '@/lib/security/idempotency'
import { resolvePartnerPayoutCharge, partnerHasCoveringPayoutSlab } from '@/lib/payout-charge'
import { bookPartnerRevenue } from '@/lib/commission/partner-revenue'
import { SCHEME_NOT_ASSIGNED, SCHEME_NOT_ASSIGNED_STATUS, SCHEME_NO_VALID_SLAB } from '@/lib/scheme-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

/**
 * POST /api/partner/payout/transfer
 *
 * Initiate a bank account transfer (payout) via Knteer Solution.
 * Debits the partner's wallet and transfers to the specified bank account.
 *
 * Requires: x-api-key, x-signature, x-timestamp headers.
 * Feature gate: Settlement / Payout must be enabled for this partner by admin.
 */
export async function POST(request: NextRequest) {
  const idemKey = getIdempotencyKeyFromHeaders(request.headers)
  const IDEM_SCOPE = 'partner_knteer_payout'

  try {
    // ── HMAC Authentication ────────────────────────────────────────────────
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

    // ── Feature gate: Settlement / Payout must be enabled ─────────────────
    const payoutAccess = partnerCanUseApi(partner, 'payout')
    if (!payoutAccess.allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: payoutAccess.message } },
        { status: 403 }
      )
    }

    // ── Idempotency ────────────────────────────────────────────────────────
    const idempResult = await reserveIdempotencyKey({
      scope: `${IDEM_SCOPE}:${partner.id}`,
      key: idemKey,
      userId: partner.id,
    })
    if (!idempResult.fresh) {
      if (idempResult.cachedResponse) {
        return NextResponse.json(idempResult.cachedResponse, { status: idempResult.cachedResponse?.status_code || 200 })
      }
      return NextResponse.json(
        { success: false, error: { code: 'DUPLICATE', message: 'Request with this idempotency key is already being processed.' } },
        { status: 409 }
      )
    }

    // ── Parse + Validate Body ──────────────────────────────────────────────
    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
        { status: 400 }
      )
    }

    const {
      accountNumber, ifscCode, accountHolderName, bankName,
      email, mobile, amount, paymentMode = 'IMPS', remarks,
    } = body

    if (!accountNumber || !ifscCode || !accountHolderName || !bankName || !amount) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'accountNumber, ifscCode, accountHolderName, bankName and amount are required' } },
        { status: 400 }
      )
    }
    if (!mobile) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'mobile (beneficiary mobile number) is required' } },
        { status: 400 }
      )
    }

    const validModes = ['IMPS', 'NEFT']
    if (!validModes.includes(paymentMode)) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'paymentMode must be IMPS or NEFT' } },
        { status: 400 }
      )
    }

    const mobileRegex = /^[6-9]\d{9}$/
    if (!mobileRegex.test(String(mobile))) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid mobile number — must be a 10-digit Indian mobile number' } },
        { status: 400 }
      )
    }

    const amountNum = parseFloat(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid amount' } },
        { status: 400 }
      )
    }
    if (amountNum < 100) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Minimum transfer amount is ₹100' } },
        { status: 400 }
      )
    }
    if (amountNum > 200000) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Maximum transfer amount is ₹2,00,000' } },
        { status: 400 }
      )
    }

    const supabase = getSupabase()

    // ── Scheme + charges ───────────────────────────────────────────────────
    const { baseCharge, schemeId, schemeName } = await resolvePartnerPayoutCharge(supabase, partner.id, amountNum, paymentMode)
    if (!schemeId) {
      console.error(`[Partner Payout/Knteer] BLOCKED: No scheme for partner=${partner.id}`)
      if (idemKey) await finalizeIdempotencyKey({ scope: `${IDEM_SCOPE}:${partner.id}`, key: idemKey, status: 'failed' }).catch(() => {})
      return NextResponse.json(
        { success: false, error: { code: SCHEME_NOT_ASSIGNED.code, message: SCHEME_NOT_ASSIGNED.error } },
        { status: SCHEME_NOT_ASSIGNED_STATUS }
      )
    }

    const slabOk = await partnerHasCoveringPayoutSlab(supabase, partner.id, amountNum, paymentMode)
    if (!slabOk) {
      if (idemKey) await finalizeIdempotencyKey({ scope: `${IDEM_SCOPE}:${partner.id}`, key: idemKey, status: 'failed' }).catch(() => {})
      return NextResponse.json(
        { success: false, error: { code: SCHEME_NO_VALID_SLAB.code, message: SCHEME_NO_VALID_SLAB.error } },
        { status: SCHEME_NOT_ASSIGNED_STATUS }
      )
    }

    const charges = baseCharge
    const totalRequired = amountNum + charges

    // ── Partner wallet balance check ───────────────────────────────────────
    const { data: walletBalance, error: balErr } = await (supabase as any).rpc('get_partner_wallet_balance', {
      p_partner_id: partner.id,
    })
    if (balErr || walletBalance === null) {
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to check wallet balance' } },
        { status: 500 }
      )
    }
    if ((walletBalance || 0) < totalRequired) {
      if (idemKey) await finalizeIdempotencyKey({ scope: `${IDEM_SCOPE}:${partner.id}`, key: idemKey, status: 'failed' }).catch(() => {})
      return NextResponse.json({
        success: false,
        error: {
          code: 'INSUFFICIENT_BALANCE',
          message: `Insufficient balance. Required: ₹${totalRequired.toFixed(2)} (₹${amountNum} + ₹${charges} charges). Available: ₹${walletBalance.toFixed(2)}`,
        },
        wallet_balance: walletBalance,
        required: totalRequired,
        charges,
      }, { status: 400 })
    }

    // ── Check wallet frozen ────────────────────────────────────────────────
    const { data: walletInfo } = await supabase
      .from('partner_wallets')
      .select('is_frozen, freeze_reason')
      .eq('partner_id', partner.id)
      .maybeSingle()
    if (walletInfo?.is_frozen) {
      if (idemKey) await finalizeIdempotencyKey({ scope: `${IDEM_SCOPE}:${partner.id}`, key: idemKey, status: 'failed' }).catch(() => {})
      return NextResponse.json(
        { success: false, error: { code: 'WALLET_FROZEN', message: `Wallet is frozen: ${walletInfo.freeze_reason || 'Contact admin'}` } },
        { status: 403 }
      )
    }

    // ── Provider balance check ─────────────────────────────────────────────
    const providerBal = await getKnteerBalance()
    if (!providerBal.success || (providerBal.usable_balance ?? 0) < amountNum) {
      if (idemKey) await finalizeIdempotencyKey({ scope: `${IDEM_SCOPE}:${partner.id}`, key: idemKey, status: 'failed' }).catch(() => {})
      return NextResponse.json(
        { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Payout service temporarily unavailable. Please try again later.' } },
        { status: 503 }
      )
    }

    // ── Duplicate prevention — same account + amount within 60s ───────────
    const cooldownCutoff = new Date(Date.now() - 60 * 1000).toISOString()
    const { data: recentTx } = await supabase
      .from('knteer_payout_transactions')
      .select('id, status, created_at')
      .eq('retailer_id', partner.id)
      .eq('account_number', accountNumber)
      .gte('created_at', cooldownCutoff)
      .eq('status', 'SUCCESS')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (recentTx) {
      const secsAgo = Math.round((Date.now() - new Date(recentTx.created_at).getTime()) / 1000)
      const remaining = Math.max(1, 60 - secsAgo)
      if (idemKey) await finalizeIdempotencyKey({ scope: `${IDEM_SCOPE}:${partner.id}`, key: idemKey, status: 'failed' }).catch(() => {})
      return NextResponse.json({
        success: false,
        error: { code: 'DUPLICATE', message: `Please wait ${remaining} seconds before making another transfer to this account.` },
        wait_seconds: remaining,
      }, { status: 429 })
    }

    // ── Generate unique partnerTransId ─────────────────────────────────────
    const partnerTransId = generateRefId()

    // ── Create DB record ───────────────────────────────────────────────────
    const { data: txRecord, error: txError } = await supabase
      .from('knteer_payout_transactions')
      .insert({
        retailer_id: partner.id,
        user_role: 'partner',
        account_number: accountNumber,
        ifsc_code: ifscCode,
        account_holder_name: accountHolderName,
        bank_name: bankName,
        email: email || '',
        mobile: String(mobile),
        amount: amountNum,
        charges,
        total_debit: totalRequired,
        payment_mode: paymentMode,
        partner_trans_id: partnerTransId,
        status: 'PENDING',
        remarks: remarks || null,
        narration: remarks || `Partner payout to ${accountHolderName}`,
        scheme_id: schemeId,
        scheme_name: schemeName,
        distributor_id: null,
        md_id: null,
      })
      .select()
      .single()

    if (txError || !txRecord) {
      console.error('[Partner Payout/Knteer] DB insert failed:', txError)
      if (idemKey) await finalizeIdempotencyKey({ scope: `${IDEM_SCOPE}:${partner.id}`, key: idemKey, status: 'failed' }).catch(() => {})
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create transaction record' } },
        { status: 500 }
      )
    }

    // ── Debit partner wallet ───────────────────────────────────────────────
    const debitDesc = `Knteer payout ₹${amountNum}${charges > 0 ? ` + charge ₹${charges}` : ''} to ${accountHolderName} (${accountNumber.slice(-4)})`
    const { error: debitError } = await (supabase as any).rpc('debit_partner_wallet', {
      p_partner_id: partner.id,
      p_amount: totalRequired,
      p_description: debitDesc,
      p_reference_id: `${partnerTransId}_TRANSFER`,
      p_service_type: 'knteer_payout',
    })

    if (debitError) {
      await supabase.from('knteer_payout_transactions').update({ status: 'FAILED', status_message: 'Wallet debit failed' }).eq('id', txRecord.id)
      if (idemKey) await finalizeIdempotencyKey({ scope: `${IDEM_SCOPE}:${partner.id}`, key: idemKey, status: 'failed' }).catch(() => {})
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to debit wallet' } },
        { status: 500 }
      )
    }

    await supabase
      .from('knteer_payout_transactions')
      .update({ actual_wallet_debit: totalRequired, wallet_debited: true })
      .eq('id', txRecord.id)

    // ── Initiate transfer via Knteer ───────────────────────────────────────
    const transferResult = await initiateKnteerTransfer({
      supabase,
      retailerId: partner.id,
      partnerTransId,
      beneDetails: {
        email: email || `${partner.id}@knteer.payout`,
        mobile: String(mobile),
        beneName: accountHolderName,
        accountNumber,
        bankName,
        ifsc: ifscCode,
      },
      amount: amountNum,
      paymentMode: paymentMode as 'IMPS' | 'NEFT',
      remark: remarks || `Payout ${partnerTransId}`,
    })

    const isSuccess = transferResult.status === 'success'
    const isPending = transferResult.is_indeterminate || transferResult.status === 'pending'
    const isDefinitiveFail = !isSuccess && !isPending

    // ── Handle definitive failure — refund wallet ──────────────────────────
    if (isDefinitiveFail) {
      const refund = await refundKnteerPayout(supabase, {
        ...txRecord,
        user_role: 'partner',
        actual_wallet_debit: totalRequired,
        partner_trans_id: partnerTransId,
      }, { skipProviderCheck: true })
      if (refund.critical) {
        console.error('[Partner Payout/Knteer] CRITICAL refund failed:', { txId: txRecord.id, error: refund.error })
      }

      // Book revenue only on success (not failure) — no commission on failed txns
    }

    // ── Update DB ──────────────────────────────────────────────────────────
    await supabase
      .from('knteer_payout_transactions')
      .update({
        status: isSuccess ? 'SUCCESS' : isDefinitiveFail ? 'FAILED' : 'PENDING',
        status_id: transferResult.status_id || null,
        knteer_trans_id: transferResult.knteer_trans_id || null,
        utr: transferResult.utr || null,
        status_message: isSuccess
          ? `SUCCESS — UTR ${transferResult.utr}`
          : isPending
            ? 'Processing — awaiting provider confirmation'
            : transferResult.error || 'Transfer failed',
        completed_at: isSuccess ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', txRecord.id)

    // ── Book partner revenue on success ────────────────────────────────────
    if (isSuccess && charges > 0) {
      bookPartnerRevenue({
        supabase,
        service: 'payout',
        partnerId: partner.id,
        refKey: partnerTransId,
        baseCharge: charges,
        amount: amountNum,
        mode: paymentMode,
        transactionUuid: txRecord.id,
        remarksSuffix: `on ₹${amountNum} partner payout`,
      }).catch((e) => console.error('[Partner Payout/Knteer] Revenue booking failed:', e))
    }

    const responseBody = {
      success: true,
      message: isSuccess
        ? 'Transfer successful'
        : isDefinitiveFail
          ? 'Transfer failed'
          : 'Transfer initiated. Processing may take a few minutes.',
      transaction_id: txRecord.id,
      partner_trans_id: partnerTransId,
      knteer_trans_id: transferResult.knteer_trans_id || null,
      utr: transferResult.utr || null,
      status: isSuccess ? 'SUCCESS' : isDefinitiveFail ? 'FAILED' : 'PENDING',
      amount: amountNum,
      charges,
      total_debited: totalRequired,
      payment_mode: paymentMode,
      account_number: accountNumber.replace(/\d(?=\d{4})/g, '*'),
      account_holder_name: accountHolderName,
      bank_name: bankName,
      ...(schemeName ? { scheme_name: schemeName } : {}),
    }

    if (idemKey) {
      await finalizeIdempotencyKey({
        scope: `${IDEM_SCOPE}:${partner.id}`,
        key: idemKey,
        status: isDefinitiveFail ? 'failed' : 'completed',
        response: isDefinitiveFail ? undefined : responseBody,
      })
    }

    return NextResponse.json(responseBody, { status: isDefinitiveFail ? 400 : 200 })
  } catch (err: any) {
    console.error('[Partner Payout/Knteer] Unhandled error:', err)
    if (idemKey) await finalizeIdempotencyKey({ scope: `${IDEM_SCOPE}:unknown`, key: idemKey, status: 'failed' }).catch(() => {})
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
