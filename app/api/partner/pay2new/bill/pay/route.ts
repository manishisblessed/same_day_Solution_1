import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { pay2newPayBill } from '@/services/pay2new'
import { isBillerRateLimitError, BILLER_RATE_LIMIT_MESSAGE, toUserSafeError } from '@/lib/provider-error'
import { SCHEME_NOT_ASSIGNED, SCHEME_NOT_ASSIGNED_STATUS, SCHEME_NO_VALID_SLAB, hasCoveringBbpsSlab } from '@/lib/scheme-guard'
import { getPartnerApiMax } from '@/lib/txn-limits'
import { computeGst, getBbpsSlabGstInclusive } from '@/lib/scheme-gst'
import { findPriorPay2NewAttempt, resolvePay2NewDebitState, type Pay2NewResolvedState } from '@/lib/pay2new/ledger-status'
import { buildPay2NewStatusPayload, type Pay2NewStatusPayloadInput } from '@/lib/partner-webhook/pay2new-payload'
import { deliverPartnerCallbackByPartnerId } from '@/lib/partner-webhook/deliver'

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
 * Push a terminal Pay2New pay state to the partner (fire-and-forget, signed).
 * Only terminal states are emitted — a PENDING replay is not a webhook event.
 * This is what self-heals a lost bill/pay response: even if the HTTP reply never
 * reaches the partner, the outcome is delivered (and re-delivered by the recon /
 * callback-retry crons).
 */
function emitPay2NewWebhook(supabase: SupabaseClient, partnerId: string, input: Pay2NewStatusPayloadInput): void {
  if (input.status === 'PENDING') return
  const payload = buildPay2NewStatusPayload(input)
  void deliverPartnerCallbackByPartnerId({
    supabase,
    partnerId,
    txnId: input.requestId,
    payload,
    event: 'pay2new.cc.status',
    logPrefix: 'Pay2New Partner Callback',
  }).catch(() => {})
}

function emitResolved(supabase: SupabaseClient, partnerId: string, r: Pay2NewResolvedState): void {
  emitPay2NewWebhook(supabase, partnerId, {
    billFetchRef: r.billFetchRef,
    requestId: r.requestId,
    orderId: r.orderId,
    status: r.status,
    amount: r.amount,
    charge: r.charge,
    operatorReference: r.operatorReference,
  })
}

/**
 * Build the HTTP response for an idempotent replay of a prior payment attempt.
 * The partner never gets a second charge: they get the ORIGINAL outcome, with a
 * clear instruction for non-success states. A new payment requires a fresh bill
 * fetch (new bill_fetch_ref).
 */
function replayResponse(r: Pay2NewResolvedState) {
  switch (r.status) {
    case 'SUCCESS':
      return {
        success: true,
        order_id: r.orderId,
        operator_reference: r.operatorReference,
        amount: r.amount,
        charge: r.charge,
        request_id: r.requestId,
        bill_fetch_ref: r.billFetchRef,
        status: 'SUCCESS',
        idempotent_replay: true,
      }
    case 'PENDING':
      return {
        success: false,
        error: { code: 'PAYMENT_PENDING', message: 'A payment for this bill_fetch_ref is still being processed. Poll bill/status for the final state — do NOT retry bill/pay.' },
        status: 'PENDING',
        request_id: r.requestId,
        bill_fetch_ref: r.billFetchRef,
        idempotent_replay: true,
      }
    case 'REFUNDED':
      return {
        success: false,
        error: { code: 'PAYMENT_REFUNDED', message: 'The previous payment for this bill_fetch_ref failed and was refunded. Fetch a new bill to retry.' },
        status: 'REFUNDED',
        refunded: true,
        request_id: r.requestId,
        bill_fetch_ref: r.billFetchRef,
        idempotent_replay: true,
      }
    default: // FAILED
      return {
        success: false,
        error: { code: 'PAYMENT_FAILED', message: 'The previous payment for this bill_fetch_ref failed. Fetch a new bill to retry.' },
        status: 'FAILED',
        request_id: r.requestId,
        bill_fetch_ref: r.billFetchRef,
        idempotent_replay: true,
      }
  }
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
    const access = partnerCanUseApi(partner, 'bbps2')
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

    const {
      number, amount, product_code, product_name,
      bill_fetch_ref, pan_number, customer_number, customer_name,
      optional1, optional2, optional3, optional4, pincode, client_ref,
    } = body

    // Optional partner-supplied idempotency key (in addition to bill_fetch_ref).
    const clientRef = client_ref ? String(client_ref).trim() || null : null

    if (!number || !amount || !product_code || !bill_fetch_ref || !customer_number) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'number, amount, product_code, bill_fetch_ref, and customer_number are required' } },
        { status: 400 }
      )
    }

    const amountNum = Number(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Amount must be greater than 0' } },
        { status: 400 }
      )
    }

    const supabase = getSupabase()

    // ── Idempotency (A + C) ──────────────────────────────────────────────
    // A partner may hold at most ONE payment attempt per bill_fetch_ref (or
    // explicit client_ref). If a prior attempt exists, replay its authoritative
    // outcome instead of charging again. This is what makes bill/pay safe to
    // retry after a lost response: a retry can NEVER create a second charge.
    const priorAttempt = await findPriorPay2NewAttempt(supabase, partner.id, String(bill_fetch_ref), clientRef)
    if (priorAttempt) {
      const resolved = await resolvePay2NewDebitState(supabase, partner.id, priorAttempt)
      emitResolved(supabase, partner.id, resolved)
      return NextResponse.json(replayResponse(resolved))
    }

    // PAN is mandatory for bill payments above ₹49,999
    const PAN_MANDATORY_ABOVE = 49999
    // Configurable upper ceiling. Per-partner limit (partners.api_max_txn_amount)
    // overrides the global Pay2New limit; enforced server-side so no partner can
    // exceed it even if a scheme slab is mis-configured higher.
    const maxTxnAmount = await getPartnerApiMax(supabase, partner.api_max_txn_amount)
    if (amountNum > maxTxnAmount) {
      return NextResponse.json(
        { success: false, error: { code: 'AMOUNT_LIMIT_EXCEEDED', message: `Amount exceeds the maximum allowed limit of ₹${maxTxnAmount.toLocaleString('en-IN')}` } },
        { status: 400 }
      )
    }
    const normalizedPan = String(pan_number || '').trim().toUpperCase()
    if (amountNum > PAN_MANDATORY_ABOVE && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(normalizedPan)) {
      return NextResponse.json(
        { success: false, error: { code: 'PAN_REQUIRED', message: 'PAN number is mandatory for payments above ₹49,999' } },
        { status: 400 }
      )
    }

    // CC1++ gate: high-value (> ₹49,999) Pay2New CC payments require the
    // credit_card1_plus add-on flag enabled on the partner account.
    if (amountNum > PAN_MANDATORY_ABOVE && !partner.credit_card1_plus_enabled) {
      return NextResponse.json(
        { success: false, error: { code: 'CC1_PLUS_REQUIRED', message: 'Credit Card-1++ is not enabled for this partner account. Contact admin to make payments above ₹49,999.' } },
        { status: 403 }
      )
    }

    // Resolve scheme charges for partner
    let serviceCharge = 0
    let resolvedSchemeId: string | null = null
    const schemeCategory = 'Credit Card'

    try {
      const { data: schemeResult, error: schemeError } = await (supabase as any).rpc('resolve_scheme_for_user', {
        p_user_id: partner.id,
        p_user_role: 'partner',
        p_service_type: 'bbps',
        p_distributor_id: null,
        p_md_id: null,
      })

      if (schemeError) {
        console.error('[Partner Pay2New Pay] Scheme RPC error:', schemeError)
      } else if (schemeResult && schemeResult.length > 0) {
        const resolved = schemeResult[0]
        resolvedSchemeId = resolved.scheme_id

        const { data: chargeResult, error: chargeError } = await (supabase as any).rpc('calculate_bbps_charge_from_scheme', {
          p_scheme_id: resolved.scheme_id,
          p_amount: amountNum,
          p_category: schemeCategory,
        })

        if (chargeError) {
          console.error('[Partner Pay2New Pay] Charge calculation error:', chargeError)
        } else if (chargeResult && chargeResult.length > 0 && parseFloat(chargeResult[0].retailer_charge) > 0) {
          serviceCharge = parseFloat(chargeResult[0].retailer_charge)
        } else {
          const { data: slabs } = await (supabase as any)
            .from('scheme_bbps_commissions')
            .select('*')
            .eq('scheme_id', resolved.scheme_id)
            .eq('status', 'active')
            .lte('min_amount', amountNum)
            .gte('max_amount', amountNum)
            .order('min_amount', { ascending: false })

          if (slabs && slabs.length > 0) {
            const bestSlab = slabs.find((s: any) => {
              const sc = s.category
              return !sc || sc === '' || sc.toLowerCase() === 'all' || sc.toLowerCase() === 'all categories' || sc === schemeCategory
            })
            if (bestSlab) {
              const rc = parseFloat(bestSlab.retailer_charge) || 0
              serviceCharge = bestSlab.retailer_charge_type === 'percentage'
                ? Math.round(amountNum * rc / 100 * 100) / 100
                : rc
            }
          }
        }
      }
    } catch (schemeErr) {
      console.error('[Partner Pay2New Pay] Scheme resolution failed:', schemeErr)
    }

    // FINANCIAL SAFETY: no explicitly assigned scheme => refuse the payment.
    // Without this, an unmapped partner would pay with a ₹0 charge (revenue loss).
    if (!resolvedSchemeId) {
      console.error(`[Partner Pay2New Pay] BLOCKED: No scheme assigned for partner=${partner.id} — refusing free transaction`)
      return NextResponse.json(
        { success: false, error: { code: SCHEME_NOT_ASSIGNED.code, message: SCHEME_NOT_ASSIGNED.error } },
        { status: SCHEME_NOT_ASSIGNED_STATUS }
      )
    }

    // A scheme is assigned but it must have a slab covering this amount + category,
    // otherwise the charge resolves to ₹0. Refuse rather than process for free.
    const bbpsSlabOk = await hasCoveringBbpsSlab(supabase, resolvedSchemeId, amountNum, schemeCategory)
    if (!bbpsSlabOk) {
      console.error(`[Partner Pay2New Pay] BLOCKED: No valid slab for partner=${partner.id} scheme=${resolvedSchemeId} amount=${amountNum}`)
      return NextResponse.json(
        { success: false, error: { code: SCHEME_NO_VALID_SLAB.code, message: SCHEME_NO_VALID_SLAB.error } },
        { status: SCHEME_NOT_ASSIGNED_STATUS }
      )
    }

    // CC1++ gate: high-value payments require a scheme slab that covers the amount.
    if (amountNum > PAN_MANDATORY_ABOVE) {
      let hasCoveringSlab = false
      if (resolvedSchemeId) {
        const { data: coverSlabs } = await (supabase as any)
          .from('scheme_bbps_commissions')
          .select('category')
          .eq('scheme_id', resolvedSchemeId)
          .eq('status', 'active')
          .lte('min_amount', amountNum)
          .gte('max_amount', amountNum)
        hasCoveringSlab = (coverSlabs || []).some((s: any) => {
          const sc = s.category
          return !sc || sc === '' || sc.toLowerCase() === 'all' || sc.toLowerCase() === 'all categories' || sc === schemeCategory
        })
      }
      if (!hasCoveringSlab) {
        return NextResponse.json(
          { success: false, error: { code: 'NO_SCHEME_SLAB', message: 'No scheme slab configured for this amount. Contact admin to add a Credit Card slab covering payments above ₹49,999.' } },
          { status: 400 }
        )
      }
    }

    // GST applies only when the matched slab is configured as GST-inclusive.
    const gstInclusive = await getBbpsSlabGstInclusive(supabase, resolvedSchemeId, amountNum, schemeCategory)
    const { totalCharge: totalServiceCharge } = computeGst(serviceCharge, gstInclusive)
    const totalDebit = amountNum + totalServiceCharge

    // Check partner wallet balance
    const { data: walletBalance, error: balErr } = await supabase.rpc('get_partner_wallet_balance', {
      p_partner_id: partner.id,
    })
    if (balErr || walletBalance === null) {
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to check wallet balance' } },
        { status: 500 }
      )
    }

    // Check if wallet is frozen
    const { data: walletInfo } = await supabase
      .from('partner_wallets')
      .select('is_frozen, freeze_reason')
      .eq('partner_id', partner.id)
      .maybeSingle()

    if (walletInfo?.is_frozen) {
      return NextResponse.json(
        { success: false, error: { code: 'WALLET_FROZEN', message: `Wallet is frozen: ${walletInfo.freeze_reason || 'Contact admin'}` } },
        { status: 400 }
      )
    }

    if ((walletBalance || 0) < totalDebit) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient partner wallet balance' },
          wallet_balance: walletBalance || 0, bill_amount: amountNum, charge: totalServiceCharge, required_amount: totalDebit,
        },
        { status: 400 }
      )
    }

    const request_id = `SDS${Date.now()}`

    // Debit partner wallet BEFORE calling provider
    const { error: debitErr } = await supabase.rpc('debit_partner_wallet', {
      p_partner_id: partner.id,
      p_amount: totalDebit,
      p_payout_transaction_id: null,
      p_description: `BBPS-2 CC ₹${amountNum} + ₹${totalServiceCharge} charge | ${product_name || product_code} | Card:****${number} | Mob:${customer_number}${customer_name ? ` | Name:${customer_name}` : ''}`,
      p_reference_id: request_id,
      p_service_type: 'pay2new',
    })
    if (debitErr) {
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to debit wallet' } },
        { status: 500 }
      )
    }

    const refund = async (reason: string) => {
      const { error: refundErr } = await supabase.rpc('refund_partner_wallet', {
        p_partner_id: partner.id,
        p_amount: totalDebit,
        p_payout_transaction_id: null,
        p_description: `BBPS-2 refund ₹${totalDebit} | ${product_name || product_code} | Card:****${number} — ${reason}`,
        p_reference_id: `REFUND_${request_id}`,
        p_service_type: 'pay2new',
      })
      if (refundErr) console.error('[Partner Pay2New Pay] CRITICAL refund failed:', refundErr)
    }

    // Stamp the recovery / idempotency keys (and PAN) onto the debit row. The
    // UNIQUE partial index on (partner_id, bill_fetch_ref) for pay2new debits is
    // the race-safe backstop: if a concurrent request already claimed this
    // bill_fetch_ref, this UPDATE fails — we unwind THIS debit and replay the
    // winner's outcome, so the customer is never charged twice.
    const { error: stampErr } = await supabase
      .from('partner_wallet_ledger')
      .update({ bill_fetch_ref: String(bill_fetch_ref), client_ref: clientRef, pan_number: normalizedPan || null })
      .eq('partner_id', partner.id)
      .eq('reference_id', request_id)

    if (stampErr) {
      if (/duplicate key|unique|23505/i.test(stampErr.message || '')) {
        await refund('concurrent duplicate for same bill_fetch_ref')
        await supabase
          .from('partner_wallet_ledger')
          .update({ status: 'failed' })
          .eq('partner_id', partner.id)
          .eq('reference_id', request_id)
        const winner = await findPriorPay2NewAttempt(supabase, partner.id, String(bill_fetch_ref), clientRef, request_id)
        if (winner) {
          // Winner is in-flight right now; don't hit the provider (it would just
          // say PENDING). Report PENDING so the partner polls bill/status.
          const resolved = await resolvePay2NewDebitState(supabase, partner.id, winner, { checkUpstream: false })
          emitResolved(supabase, partner.id, resolved)
          return NextResponse.json(replayResponse(resolved))
        }
        return NextResponse.json(
          { success: false, error: { code: 'IDEMPOTENCY_CONFLICT', message: 'A payment for this bill_fetch_ref is already in progress.' }, request_id },
          { status: 409 }
        )
      }
      // Non-unique stamp failure is non-fatal: the debit + request_id are valid,
      // the payment can still proceed and be reconciled by request_id.
      console.error('[Partner Pay2New Pay] Failed to stamp idempotency keys:', stampErr)
    }

    let result
    try {
      result = await pay2newPayBill({
        number,
        amount: amountNum,
        product_code: String(product_code),
        request_id,
        bill_fetch_ref,
        pan_number: normalizedPan,
        optional1: optional1 || '',
        optional2: optional2 || '',
        optional3: optional3 || '',
        optional4: optional4 || '',
        customer_number,
        pincode: pincode || '414002',
      })
    } catch (provErr: any) {
      await refund('provider error')
      // Mark the debit failed (payout_transaction_id is a uuid column and cannot
      // hold a "FAILED:" marker — that write silently errored previously).
      await supabase
        .from('partner_wallet_ledger')
        .update({ status: 'failed' })
        .eq('partner_id', partner.id)
        .eq('reference_id', request_id)
      // Push terminal state so the partner self-heals even if this HTTP reply is
      // lost. Wallet was refunded, so the partner-facing state is REFUNDED.
      emitPay2NewWebhook(supabase, partner.id, {
        billFetchRef: String(bill_fetch_ref), requestId: request_id, orderId: null,
        status: 'REFUNDED', amount: amountNum, charge: totalServiceCharge,
        operatorReference: null, message: 'provider error',
      })
      return NextResponse.json(
        { success: false, error: { code: 'PROVIDER_ERROR', message: toUserSafeError(provErr?.message, 'Bill payment failed') }, request_id },
        { status: 200 }
      )
    }

    if (!result.success) {
      await refund(result.error || 'payment failed')
      // Store failed status in ledger for status lookups (payout_transaction_id
      // is a uuid column, so the old "FAILED:" marker write silently errored).
      await supabase
        .from('partner_wallet_ledger')
        .update({ status: 'failed' })
        .eq('partner_id', partner.id)
        .eq('reference_id', request_id)
      // Push terminal state (wallet refunded -> REFUNDED) so a lost reply still
      // reaches the partner.
      emitPay2NewWebhook(supabase, partner.id, {
        billFetchRef: String(bill_fetch_ref), requestId: request_id, orderId: null,
        status: 'REFUNDED', amount: amountNum, charge: totalServiceCharge,
        operatorReference: null, message: result.error || 'payment failed',
      })
      const rateLimited = isBillerRateLimitError(result.error)
      return NextResponse.json(
        {
          success: false,
          error: {
            code: rateLimited ? 'BILLER_RATE_LIMITED' : 'PAYMENT_FAILED',
            message: rateLimited ? BILLER_RATE_LIMIT_MESSAGE : (result.error || 'Payment failed'),
          },
          retryable: rateLimited || undefined,
          request_id,
        },
        { status: 200 }
      )
    }

    // Store order_id in the description for status lookups / reconciliation.
    // (payout_transaction_id is a uuid column and cannot hold Pay2New's order_id
    // like "P2F...", so it is intentionally not written here.)
    await supabase
      .from('partner_wallet_ledger')
      .update({
        description: `BBPS-2 CC ₹${amountNum} + ₹${totalServiceCharge} charge | ${product_name || product_code} | Card:****${number} | Mob:${customer_number}${customer_name ? ` | Name:${customer_name}` : ''} | OrderID:${result.order_id} | Ref:${result.operator_reference || 'N/A'}`,
      })
      .eq('partner_id', partner.id)
      .eq('reference_id', request_id)

    // Push the terminal SUCCESS so the partner self-heals a lost reply (the exact
    // incident: payment succeeded here, response never reached the partner).
    emitPay2NewWebhook(supabase, partner.id, {
      billFetchRef: String(bill_fetch_ref), requestId: request_id,
      orderId: result.order_id || null, status: 'SUCCESS',
      amount: typeof result.amount === 'number' ? result.amount : amountNum,
      charge: totalServiceCharge, operatorReference: result.operator_reference || null,
    })

    return NextResponse.json({
      success: true,
      order_id: result.order_id,
      operator_reference: result.operator_reference,
      amount: result.amount,
      charge: totalServiceCharge,
      request_id,
    })
  } catch (error: any) {
    console.error('[Partner Pay2New Pay] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
