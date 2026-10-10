import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { authorizeSubPartner, normalizeMasterPartner } from '@/lib/partner-access'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { pay2newPayBill, settlePay2New } from '@/services/pay2new'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { createClient } from '@supabase/supabase-js'
import { fetchBillerInfo, fetchBill, payRequest } from '@/services/bbps'
import { generateAgentTransactionId } from '@/services/bbps/helpers'
import { toUserSafeError } from '@/lib/provider-error'
import { distributeServiceCommission } from '@/lib/commission/distribute-service-commission'
import { isBillerRateLimitError, BILLER_RATE_LIMIT_MESSAGE } from '@/lib/provider-error'
import { SCHEME_NOT_ASSIGNED, SCHEME_NOT_ASSIGNED_STATUS, SCHEME_NO_VALID_SLAB } from '@/lib/scheme-guard'
import { getGlobalPay2newMax } from '@/lib/txn-limits'
import { computeGst, getBbpsSlabGstInclusive } from '@/lib/scheme-gst'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const { user } = await getCurrentUserWithFallback(request)
    normalizeMasterPartner(user)

    if (!user) {
      const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      return addCorsHeaders(request, response)
    }

    const access = authorizeSubPartner(user, ['bbps-2', 'credit-card'])
    if (!access.ok) return access.response

    // Only retailers transact Pay2New; the debit lands on the retailer's wallet.
    if (!['retailer', 'partner'].includes(user.role) || !user.partner_id) {
      const response = NextResponse.json(
        { success: false, error: 'Access denied' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const rl = rateLimit(request, { ...RATE_LIMITS.bbpsPay, identifier: user.partner_id })
    if (rl.limited) return addCorsHeaders(request, rl.response!)

    const { number, amount, product_code, product_name, bill_fetch_ref, pan_number, optional1, optional2, optional3, optional4, customer_number, customer_name, pincode, tpin, use_bbps, biller_id: frontendBillerId } = body

    if (!number || !amount || !product_code || !bill_fetch_ref || !customer_number) {
      const response = NextResponse.json(
        { success: false, error: 'Missing required fields: number, amount, product_code, bill_fetch_ref, customer_number' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Registered mobile uniquely identifies the cardholder for credit-card
    // billers; a missing/invalid one lets the provider resolve the wrong account.
    // Enforce for CC billers only (other categories use different consumer formats).
    const isCreditCardBiller = /credit\s*card/i.test(String(product_name || ''))
    if (isCreditCardBiller && !/^\d{10}$/.test(String(customer_number).trim())) {
      const response = NextResponse.json(
        { success: false, error: 'A valid 10-digit registered mobile number is required.' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // TPIN is mandatory for Credit Card / Pay2New transactions
    if (!tpin || !/^\d{4,6}$/.test(String(tpin).trim())) {
      const response = NextResponse.json(
        { success: false, error: 'T-PIN is required', tpin_error: true },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const amountNum = Number(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      const response = NextResponse.json(
        { success: false, error: 'Amount must be greater than 0' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // PAN is mandatory for bill payments above ₹49,999
    const PAN_MANDATORY_ABOVE = 49999
    const normalizedPan = String(pan_number || '').trim().toUpperCase()
    if (amountNum > PAN_MANDATORY_ABOVE && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(normalizedPan)) {
      const response = NextResponse.json(
        { success: false, error: 'PAN number is mandatory for payments above ₹49,999', pan_error: true },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const supabaseAdmin = getSupabaseAdmin()

    // Configurable max transaction ceiling for the in-app flow (retailers &
    // partners), set from Admin → Settings → Limits. Enforced server-side.
    const maxTxnAmount = await getGlobalPay2newMax(supabaseAdmin)
    if (amountNum > maxTxnAmount) {
      const response = NextResponse.json(
        { success: false, error: `Amount exceeds the maximum allowed limit of ₹${maxTxnAmount.toLocaleString('en-IN')}`, amount_limit_exceeded: true },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // CC1++ gate: high-value (> ₹49,999) Pay2New CC payments require the
    // credit_card1_plus add-on flag enabled on the acting user's account.
    if (amountNum > PAN_MANDATORY_ABOVE) {
      const flagTable = user.role === 'partner' ? 'partners' : 'retailers'
      const flagIdCol = user.role === 'partner' ? 'id' : 'partner_id'
      const { data: flagRow } = await (supabaseAdmin as any)
        .from(flagTable)
        .select('credit_card1_plus_enabled')
        .eq(flagIdCol, user.partner_id)
        .maybeSingle()
      if (!flagRow?.credit_card1_plus_enabled) {
        const response = NextResponse.json(
          { success: false, error: 'Credit Card-1++ is not enabled for your account. Contact admin to make payments above ₹49,999.', cc1_plus_required: true },
          { status: 403 }
        )
        return addCorsHeaders(request, response)
      }
    }

    const tpinFn = user.role === 'partner' ? 'verify_partner_tpin' : 'verify_retailer_tpin'
    const tpinParam = user.role === 'partner' ? 'p_partner_id' : 'p_retailer_id'
    const { data: tpinResult, error: tpinError } = await (supabaseAdmin as any).rpc(tpinFn, {
      [tpinParam]: user.partner_id,
      p_tpin: String(tpin).trim(),
    })
    if (tpinError || !tpinResult?.success) {
      const msg = tpinResult?.error || tpinError?.message || 'TPIN verification failed'
      const response = NextResponse.json(
        { success: false, error: msg, tpin_error: true, attempts_remaining: tpinResult?.attempts_remaining, locked_until: tpinResult?.locked_until },
        { status: 401 }
      )
      return addCorsHeaders(request, response)
    }

    // Same-card cooldown is enforced atomically right before the wallet debit
    // (see pay2new_cooldown_claim below) — a plain pre-check here would reopen
    // the check-then-act race that allowed double charges.

    // Retailer hierarchy for scheme resolution
    let distributorId: string | null = null
    let mdId: string | null = null
    try {
      const { data: retailerData } = await (supabaseAdmin as any)
        .from('retailers')
        .select('distributor_id, master_distributor_id')
        .eq('partner_id', user.partner_id)
        .maybeSingle()
      distributorId = retailerData?.distributor_id || null
      mdId = retailerData?.master_distributor_id || null
    } catch (e) {
      console.warn('[Pay2New Bill Pay] Failed to fetch retailer hierarchy:', e)
    }

    // Resolve scheme charges (uses BBPS scheme with "Credit Card" category)
    let serviceCharge = 0
    let resolvedSchemeId: string | null = null
    let resolvedSchemeName: string | null = null
    let resolvedVia: string | null = null
    let commissionSplit = { retailer_commission: 0, distributor_commission: 0, md_commission: 0 }
    let chargeModelData: { md_purchase_charge: number; dt_purchase_charge: number; rt_purchase_charge: number; company_cost: number; reverify?: { serviceKind: 'BBPS' | 'PAYOUT'; scopeKey?: string | null; category?: string | null; amount: number } | null } | null = null
    const schemeCategory = 'Credit Card'

    try {
      const { data: schemeResult, error: schemeError } = await (supabaseAdmin as any).rpc('resolve_scheme_for_user', {
        p_user_id: user.partner_id,
        p_user_role: user.role,
        p_service_type: 'bbps',
        p_distributor_id: distributorId,
        p_md_id: mdId,
      })

      if (schemeError) {
        console.error('[Pay2New Bill Pay] Scheme RPC error:', schemeError)
      } else if (schemeResult && schemeResult.length > 0) {
        const resolved = schemeResult[0]
        resolvedSchemeId = resolved.scheme_id
        resolvedSchemeName = resolved.scheme_name
        resolvedVia = resolved.resolved_via
        console.log(`[Pay2New Bill Pay] Scheme resolved: "${resolved.scheme_name}" via ${resolved.resolved_via}`)

        const { data: chargeResult, error: chargeError } = await (supabaseAdmin as any).rpc('calculate_bbps_charge_from_scheme', {
          p_scheme_id: resolved.scheme_id,
          p_amount: amountNum,
          p_category: schemeCategory,
        })

        if (chargeError) {
          console.error('[Pay2New Bill Pay] Charge calculation error:', chargeError)
        } else if (chargeResult && chargeResult.length > 0 && parseFloat(chargeResult[0].retailer_charge) > 0) {
          serviceCharge = parseFloat(chargeResult[0].retailer_charge)
          commissionSplit = {
            retailer_commission: parseFloat(chargeResult[0].retailer_commission) || 0,
            distributor_commission: parseFloat(chargeResult[0].distributor_commission) || 0,
            md_commission: parseFloat(chargeResult[0].md_commission) || 0,
          }
          const mdPc = parseFloat(chargeResult[0].md_purchase_charge_val) || 0
          const dtPc = parseFloat(chargeResult[0].dt_purchase_charge_val) || 0
          const rtPc = parseFloat(chargeResult[0].rt_purchase_charge_val) || 0
          if (mdPc > 0 || dtPc > 0 || rtPc > 0) {
            chargeModelData = {
              md_purchase_charge: mdPc,
              dt_purchase_charge: dtPc,
              rt_purchase_charge: rtPc,
              company_cost: parseFloat(chargeResult[0].company_earning) || 0,
              // #5 re-verify the company cost against the live central BBPS vendor
              // card at settlement, keyed by category (scope wildcard).
              reverify: { serviceKind: 'BBPS', scopeKey: null, category: schemeCategory, amount: amountNum },
            }
          }
          console.log(`[Pay2New Bill Pay] Charge: ₹${serviceCharge}, commissions: RT=${commissionSplit.retailer_commission}, DT=${commissionSplit.distributor_commission}, MD=${commissionSplit.md_commission}${chargeModelData ? ' [CHARGE MODEL]' : ''}`)
        } else {
          // Fallback: direct slab query
          const { data: slabs } = await (supabaseAdmin as any)
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
              // Charge-based model stores the retailer price in rt_purchase_charge;
              // fall back to the legacy retailer_charge only when rt is not set.
              const rtPc = parseFloat(bestSlab.rt_purchase_charge) || 0
              const rc = rtPc > 0 ? rtPc : (parseFloat(bestSlab.retailer_charge) || 0)
              const rcType = rtPc > 0 ? (bestSlab.rt_purchase_charge_type || 'flat') : bestSlab.retailer_charge_type
              serviceCharge = rcType === 'percentage'
                ? Math.round(amountNum * rc / 100 * 100) / 100
                : rc
              const calcComm = (val: number, type: string) => type === 'percentage' ? Math.round(amountNum * val / 100 * 100) / 100 : val
              commissionSplit = {
                retailer_commission: calcComm(parseFloat(bestSlab.retailer_commission) || 0, bestSlab.retailer_commission_type),
                distributor_commission: calcComm(parseFloat(bestSlab.distributor_commission) || 0, bestSlab.distributor_commission_type),
                md_commission: calcComm(parseFloat(bestSlab.md_commission) || 0, bestSlab.md_commission_type),
              }
              console.log(`[Pay2New Bill Pay] Charge via direct slab: ₹${serviceCharge}`)
            }
          }
        }
      }
    } catch (schemeErr) {
      console.error('[Pay2New Bill Pay] Scheme resolution failed:', schemeErr)
    }

    // CC1++ gate: high-value payments require a scheme slab that covers the amount.
    if (amountNum > PAN_MANDATORY_ABOVE) {
      let hasCoveringSlab = false
      if (resolvedSchemeId) {
        const { data: coverSlabs } = await (supabaseAdmin as any)
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
        const response = NextResponse.json(
          { success: false, error: 'No scheme slab configured for this amount. Contact admin to add a Credit Card slab covering payments above ₹49,999.', no_scheme_slab: true },
          { status: 400 }
        )
        return addCorsHeaders(request, response)
      }
    }

    if (!resolvedSchemeId) {
      console.error(`[Pay2New Bill Pay] BLOCKED: No scheme assigned for user=${user.partner_id} — refusing free transaction`)
      const response = NextResponse.json(SCHEME_NOT_ASSIGNED, { status: SCHEME_NOT_ASSIGNED_STATUS })
      return addCorsHeaders(request, response)
    }

    // A scheme is assigned but no slab priced this amount (serviceCharge stayed 0)
    // → refuse rather than process for free.
    if (serviceCharge <= 0) {
      console.error(`[Pay2New Bill Pay] BLOCKED: No valid slab for user=${user.partner_id} scheme=${resolvedSchemeId} amount=${amountNum}`)
      const response = NextResponse.json(SCHEME_NO_VALID_SLAB, { status: SCHEME_NOT_ASSIGNED_STATUS })
      return addCorsHeaders(request, response)
    }

    // GST applies only when the matched slab is configured as GST-inclusive.
    const gstInclusive = await getBbpsSlabGstInclusive(supabaseAdmin, resolvedSchemeId, amountNum, schemeCategory)
    const { totalCharge: totalServiceCharge } = computeGst(serviceCharge, gstInclusive)
    const totalDebit = amountNum + totalServiceCharge

    // Balance check
    const balanceFn = user.role === 'partner' ? 'get_partner_wallet_balance' : 'get_wallet_balance'
    const balanceParams = user.role === 'partner'
      ? { p_partner_id: user.partner_id }
      : { p_retailer_id: user.partner_id }
    const { data: walletBalance, error: balErr } = await (supabaseAdmin as any).rpc(balanceFn, balanceParams)
    if (balErr) {
      const response = NextResponse.json({ success: false, error: 'Failed to check wallet balance' }, { status: 500 })
      return addCorsHeaders(request, response)
    }
    if ((walletBalance || 0) < totalDebit) {
      const response = NextResponse.json(
        { success: false, error: 'Insufficient wallet balance', wallet_balance: walletBalance || 0, bill_amount: amountNum, charge: totalServiceCharge, required_amount: totalDebit },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const request_id = `SDS${Date.now()}`

    const markPay2NewTxn = async (status: 'success' | 'failed' | 'refunded', extra: Record<string, any> = {}) => {
      try {
        await (supabaseAdmin as any)
          .from('pay2new_transactions')
          .update({ status, completed_at: new Date().toISOString(), ...extra })
          .eq('request_id', request_id)
      } catch (e) {
        console.error('[Pay2New Bill Pay] Failed to update txn record:', e)
      }
    }

    // ── Same-card cooldown + authoritative txn record (ATOMIC, race-safe) ────
    // One advisory-locked RPC does the 60s window check AND inserts the 'pending'
    // pay2new_transactions row. Two rapid taps on the same card can no longer
    // BOTH pass the check — the second is blocked by the first's pending row.
    // Runs BEFORE the wallet debit, so a blocked request never moves money.
    const COOLDOWN_SECONDS = 60
    {
      const { data: claimRows, error: claimErr } = await (supabaseAdmin as any).rpc('pay2new_cooldown_claim', {
        p_user_id: user.partner_id,
        p_user_role: user.role,
        p_product_code: String(product_code),
        p_customer_number: String(customer_number),
        p_card_number: String(number),
        p_request_id: request_id,
        p_amount: amountNum,
        p_charge: totalServiceCharge,
        p_total_debit: totalDebit,
        p_window_seconds: COOLDOWN_SECONDS,
        p_bill_fetch_ref: bill_fetch_ref || null,
        p_product_name: product_name || null,
        p_customer_name: customer_name || null,
        p_card_last4: optional1 || null,
        p_pan_number: normalizedPan || null,
        p_distributor_id: distributorId,
        p_master_distributor_id: mdId,
        p_scheme_id: resolvedSchemeId,
        p_scheme_name: resolvedSchemeName,
        p_biller_id: frontendBillerId || null,
      })
      if (claimErr) {
        console.error('[Pay2New Bill Pay] Cooldown claim error:', claimErr)
        const response = NextResponse.json({ success: false, error: 'Failed to start payment. Please try again.' }, { status: 500 })
        return addCorsHeaders(request, response)
      }
      const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows
      if (claim?.blocked) {
        const remaining = Math.max(1, Number(claim.seconds_remaining) || COOLDOWN_SECONDS)
        const response = NextResponse.json(
          { success: false, error: `Please wait ${remaining} seconds before making another payment to this credit card.`, cooldown_seconds: remaining },
          { status: 429 }
        )
        return addCorsHeaders(request, response)
      }
    }

    // Debit total (bill + charge) from wallet BEFORE calling provider.
    let debitErr: any = null
    if (user.role === 'partner') {
      const { error } = await (supabaseAdmin as any).rpc('debit_partner_wallet', {
        p_partner_id: user.partner_id,
        p_amount: totalDebit,
        p_description: `CC ₹${amountNum} + ₹${totalServiceCharge} charge | ${product_name || product_code} | Card:${number} | Mob:${customer_number}${customer_name ? ` | Name:${customer_name}` : ''}`,
        p_reference_id: request_id,
        p_service_type: 'pay2new',
      })
      debitErr = error
    } else {
      const { error } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
        p_user_id: user.partner_id,
        p_user_role: user.role,
        p_wallet_type: 'primary',
        p_fund_category: 'service',
        p_service_type: 'pay2new',
        p_tx_type: 'PAY2NEW_DEBIT',
        p_credit: 0,
        p_debit: totalDebit,
        p_reference_id: request_id,
        p_status: 'completed',
        p_remarks: `CC ₹${amountNum} + ₹${totalServiceCharge} charge | ${product_name || product_code} | Card:${number} | Mob:${customer_number}${customer_name ? ` | Name:${customer_name}` : ''}`,
      })
      debitErr = error
    }
    if (debitErr) {
      console.error('[Pay2New Bill Pay] Debit error:', debitErr)
      // Release the cooldown slot we claimed so a no-charge failure does not lock
      // the card for 60s (the recon cron requires a DEBIT ledger row to refund,
      // so this 'failed' orphan is never credited).
      await markPay2NewTxn('failed', { error_message: 'wallet debit failed' })
      const response = NextResponse.json({ success: false, error: 'Failed to debit wallet' }, { status: 500 })
      return addCorsHeaders(request, response)
    }

    // Persist PAN to the dedicated ledger column (shown in bill payment report).
    if (normalizedPan) {
      const panTable = user.role === 'partner' ? 'partner_wallet_ledger' : 'wallet_ledger'
      const panIdCol = user.role === 'partner' ? 'partner_id' : 'retailer_id'
      await (supabaseAdmin as any)
        .from(panTable)
        .update({ pan_number: normalizedPan })
        .eq(panIdCol, user.partner_id)
        .eq('reference_id', request_id)
    }

    const refund = async (reason: string) => {
      if (user.role === 'partner') {
        const { error: refundErr } = await (supabaseAdmin as any).rpc('credit_partner_wallet', {
          p_partner_id: user.partner_id,
          p_amount: totalDebit,
          p_transaction_type: 'REFUND',
          p_description: `Refund ₹${totalDebit} | ${product_name || product_code} | Card:${number} — ${reason}`,
          p_reference_id: `REFUND_${request_id}`,
          p_service_type: 'pay2new',
        })
        if (refundErr) console.error('[Pay2New Bill Pay] CRITICAL refund failed:', refundErr)
      } else {
        const { error: refundErr } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
          p_user_id: user.partner_id, p_user_role: user.role, p_wallet_type: 'primary',
          p_fund_category: 'service', p_service_type: 'pay2new', p_tx_type: 'PAY2NEW_REFUND',
          p_credit: totalDebit, p_debit: 0,
          p_reference_id: `REFUND_${request_id}`, p_status: 'completed',
          p_remarks: `Refund ₹${totalDebit} | ${product_name || product_code} | Card:${number} | Mob:${customer_number} — ${reason}`,
        })
        if (refundErr) console.error('[Pay2New Bill Pay] CRITICAL refund failed:', refundErr)
      }
      await markPay2NewTxn('refunded', { error_message: reason })
    }

    // If bill was fetched via BBPS fallback, pay directly through BBPS
    if (use_bbps && frontendBillerId) {
      console.log('[Pay2New Bill Pay] Using direct BBPS path for biller:', frontendBillerId)
      try {
        const billerInfo = await fetchBillerInfo({ billerId: frontendBillerId, skipCache: true })
        const enquiryId = (billerInfo as any).enquiryId
        const billerName = billerInfo.billerName || product_name || ''

        const paramInfo: Array<{ paramName: string }> = billerInfo.billerInputParams?.paramInfo || []
        const bbpsInputParams: Array<{ paramName: string; paramValue: string }> = []
        for (const p of paramInfo) {
          const nameLower = p.paramName.toLowerCase()
          if (nameLower.includes('mobile') || nameLower.includes('phone')) {
            bbpsInputParams.push({ paramName: p.paramName, paramValue: optional1 || customer_number })
          } else {
            bbpsInputParams.push({ paramName: p.paramName, paramValue: number })
          }
        }
        if (bbpsInputParams.length === 0) {
          bbpsInputParams.push({ paramName: 'Card Number', paramValue: number })
        }

        const billResult = await fetchBill({
          billerId: frontendBillerId,
          consumerNumber: number,
          enquiryId,
          inputParams: bbpsInputParams,
        })

        const paymentMode =
          billResult.additional_info?.paymentMode ||
          'Internet Banking'

        const agentTxnId = generateAgentTransactionId(user.partner_id)

        const bbpsResult = await payRequest({
          billerId: frontendBillerId,
          billerName,
          consumerNumber: number,
          amount: amountNum,
          agentTransactionId: agentTxnId,
          subServiceName: 'Credit Card',
          paymentMode,
          reqId: billResult.reqId || enquiryId,
          billerResponse: billResult.additional_info?.billerResponse,
          additionalInfo: billResult.additional_info?.additionalInfo,
          inputParams: bbpsInputParams,
          customerMobileNumber: optional1 || customer_number,
        })

        if (bbpsResult.success) {
          console.log('[Pay2New→BBPS Direct] Payment succeeded:', bbpsResult.transaction_id)
          await markPay2NewTxn('success', {
            order_id: bbpsResult.transaction_id,
            operator_reference: bbpsResult.transaction_id,
            biller_id: frontendBillerId,
            payment_channel: 'bbps_direct',
          })
          const response = NextResponse.json({
            success: true,
            order_id: bbpsResult.transaction_id,
            operator_reference: bbpsResult.transaction_id,
            amount: amountNum,
            charge: totalServiceCharge,
            request_id,
            fallback: 'bbps',
          })
          return addCorsHeaders(request, response)
        }

        await refund(bbpsResult.error_message || 'BBPS payment failed')
        const response = NextResponse.json(
          { success: false, error: toUserSafeError(bbpsResult.error_message, 'Payment failed'), request_id },
          { status: 200 }
        )
        return addCorsHeaders(request, response)
      } catch (bbpsErr: any) {
        console.error('[Pay2New→BBPS Direct] Error:', bbpsErr.message)
        await refund(bbpsErr.message || 'BBPS payment error')
        const response = NextResponse.json(
          { success: false, error: toUserSafeError(bbpsErr?.message, 'Payment failed'), request_id },
          { status: 200 }
        )
        return addCorsHeaders(request, response)
      }
    }

    // ── Terminal finalizers (idempotent; money movement in ONE place) ────────
    const finalizeSuccess = async (
      orderId: string | number | null | undefined,
      operatorReference: string | null | undefined,
      amount: number | string | undefined
    ) => {
      // Per-transaction commission: retailer + distributor (idempotent refs).
      if (totalServiceCharge > 0) {
        const commResult = await distributeServiceCommission({
          supabase: supabaseAdmin,
          service: 'pay2new',
          refPrefix: 'P2N',
          refKey: request_id,
          totalCharge: totalServiceCharge,
          retailer: { id: user.partner_id as string, role: user.role, commission: commissionSplit.retailer_commission },
          distributor: { id: distributorId, commission: commissionSplit.distributor_commission },
          masterDistributor: { id: mdId },
          chargeModel: chargeModelData,
          remarksSuffix: `on CC Bill ₹${amountNum} - ${product_name || product_code}`,
        })
        if (commResult.errors.length) console.error('[Pay2New Bill Pay] Commission errors:', commResult.errors)
      }

      await markPay2NewTxn('success', {
        order_id: orderId != null ? String(orderId) : null,
        operator_reference: operatorReference ? String(operatorReference) : null,
        payment_channel: 'pay2new',
      })

      const response = NextResponse.json({
        success: true,
        order_id: orderId,
        operator_reference: operatorReference,
        amount: amount ?? amountNum,
        charge: totalServiceCharge,
        request_id,
      })
      return addCorsHeaders(request, response)
    }

    // DEFINITIVE failure → refund (refund() also marks the txn 'refunded').
    const finalizeFailed = async (reason: string) => {
      await refund(reason)
      const userError = isBillerRateLimitError(reason) ? BILLER_RATE_LIMIT_MESSAGE : reason
      const response = NextResponse.json(
        { success: false, error: userError, request_id, retryable: isBillerRateLimitError(reason) || undefined },
        { status: 200 }
      )
      return addCorsHeaders(request, response)
    }

    // UNKNOWN → leave the debit + 'pending' txn in place (NO refund). The
    // direct-user reconciliation cron confirms with the provider and either
    // records success or refunds once the txn is old enough. This is what
    // prevents a false refund (and the resulting double-charge on a retry) when
    // the biller actually charged the card.
    const finalizePending = () => {
      const response = NextResponse.json(
        {
          success: false,
          pending: true,
          status: 'PENDING',
          error: 'Your payment is being confirmed with the bank. Please check the transaction status in a few minutes before trying again — do not pay the same card again now.',
          request_id,
        },
        { status: 200 }
      )
      return addCorsHeaders(request, response)
    }

    let result: Awaited<ReturnType<typeof pay2newPayBill>> | null = null
    let threw = false
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
      threw = true
      console.error('[Pay2New Bill Pay] provider call threw:', provErr?.message)
    }

    // 1) Clear provider success.
    if (!threw && result?.success) {
      return await finalizeSuccess(result.order_id, result.operator_reference, result.amount)
    }

    // 2) DEFINITIVE provider decline (valid verdict, not a transport failure).
    if (!threw && result && !result.success && !result.ambiguous) {
      const isCashDisabled = (result.error || '').toLowerCase().includes('payment mode cash is disable')

      if (isCashDisabled) {
        console.log('[Pay2New Bill Pay] Cash mode rejected — attempting BBPS fallback')
        const billerIdMatch = (result.error || '').match(/biller\s+([A-Z0-9]+)/i)
        const extractedBillerId = billerIdMatch?.[1]

        if (extractedBillerId) {
          try {
            const billerInfo = await fetchBillerInfo({ billerId: extractedBillerId, skipCache: true })
            const enquiryId = (billerInfo as any).enquiryId
            const billerName = billerInfo.billerName || product_name || ''

            const billResult = await fetchBill({
              billerId: extractedBillerId,
              consumerNumber: number,
              enquiryId,
              inputParams: [{ paramName: 'Card Number', paramValue: number }],
            })

            const paymentMode =
              billResult.additional_info?.paymentMode ||
              'Internet Banking'

            const agentTxnId = generateAgentTransactionId(user.partner_id)

            const bbpsResult = await payRequest({
              billerId: extractedBillerId,
              billerName,
              consumerNumber: number,
              amount: amountNum,
              agentTransactionId: agentTxnId,
              subServiceName: 'Credit Card',
              paymentMode,
              reqId: billResult.reqId || enquiryId,
              billerResponse: billResult.additional_info?.billerResponse,
              additionalInfo: billResult.additional_info?.additionalInfo,
              inputParams: [{ paramName: 'Card Number', paramValue: number }],
              customerMobileNumber: customer_number,
            })

            if (bbpsResult.success) {
              console.log('[Pay2New→BBPS Fallback] Payment succeeded via BBPS:', bbpsResult.transaction_id)
              await markPay2NewTxn('success', {
                order_id: bbpsResult.transaction_id,
                operator_reference: bbpsResult.transaction_id,
                biller_id: extractedBillerId,
                payment_channel: 'bbps_fallback',
              })
              const response = NextResponse.json({
                success: true,
                order_id: bbpsResult.transaction_id,
                operator_reference: bbpsResult.transaction_id,
                amount: amountNum,
                charge: totalServiceCharge,
                request_id,
                fallback: 'bbps',
              })
              return addCorsHeaders(request, response)
            }

            console.error('[Pay2New→BBPS Fallback] BBPS also failed:', bbpsResult.error_message)
          } catch (bbpsErr: any) {
            console.error('[Pay2New→BBPS Fallback] Error:', bbpsErr.message)
          }
        }
      }

      return await finalizeFailed(result.error || 'Payment failed')
    }

    // 3) AMBIGUOUS (timeout / network / HTML) or thrown → confirm with the
    //    provider before any money moves. NEVER refund on this signal alone.
    const settled = await settlePay2New(request_id, { attempts: 2, spacingMs: 2500 })
    if (settled.outcome === 'SUCCESS') {
      return await finalizeSuccess(settled.orderId, settled.operatorReference, settled.amount)
    }
    if (settled.outcome === 'FAILED') {
      return await finalizeFailed('Payment failed')
    }
    console.warn(`[Pay2New Bill Pay] UNKNOWN outcome left PENDING for recon: request_id=${request_id} user=${user.partner_id}`)
    return finalizePending()
  } catch (error: any) {
    console.error('[Pay2New Bill Pay] Error:', error)
    const response = NextResponse.json(
      { success: false, error: toUserSafeError(error?.message, 'Bill payment failed') },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
