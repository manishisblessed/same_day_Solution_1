import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { createClient } from '@supabase/supabase-js'
import {
  rechargekitCcPayment,
  RECHARGEKIT_DEFAULT_BASE_CHARGE,
  isCreditCard2Enabled,
} from '@/services/rechargekit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GST_PERCENT = 18

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

function maskCard(accountNo: string): string {
  const digits = String(accountNo).replace(/\D/g, '')
  if (digits.length <= 4) return digits
  return `****${digits.slice(-4)}`
}

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * POST /api/rechargekit/pay
 * Credit Card-2 payment via Rechargekit
 * Records transaction in bbps_transactions for full reporting parity with BBPS-1/Pay2New.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { user } = await getCurrentUserWithFallback(request)

    if (!user) {
      const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      return addCorsHeaders(request, response)
    }

    if (!['retailer', 'partner'].includes(user.role) || !user.partner_id) {
      const response = NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 })
      return addCorsHeaders(request, response)
    }

    if (!(await isCreditCard2Enabled(user))) {
      const response = NextResponse.json(
        { success: false, error: 'Credit Card-2 service is not enabled for your account' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const rl = rateLimit(request, { ...RATE_LIMITS.bbpsPay, identifier: user.partner_id })
    if (rl.limited) return addCorsHeaders(request, rl.response!)

    const {
      mobile_no,
      account_no,
      ifsc,
      bank_name,
      beneficiary_name,
      amount,
      operator_code,
      operator_name,
      tpin,
      transfer_type,
    } = body

    if (!mobile_no || !account_no || !ifsc || !bank_name || !beneficiary_name || !amount || !operator_code) {
      const response = NextResponse.json(
        { success: false, error: 'Missing required fields: mobile_no, account_no, ifsc, bank_name, beneficiary_name, amount, operator_code' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const mobile = String(mobile_no).replace(/\D/g, '')
    if (!/^\d{10}$/.test(mobile)) {
      const response = NextResponse.json(
        { success: false, error: 'Mobile number must be 10 digits' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const cardDigits = String(account_no).replace(/\s+/g, '').replace(/\D/g, '')
    if (cardDigits.length < 12 || cardDigits.length > 19) {
      const response = NextResponse.json(
        { success: false, error: 'Enter a valid credit card number' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const ifscCode = String(ifsc).trim().toUpperCase()
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) {
      const response = NextResponse.json(
        { success: false, error: 'Enter a valid IFSC code' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

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

    const supabaseAdmin = getSupabaseAdmin()
    const cardMasked = maskCard(cardDigits)
    const bankLabel = operator_name || bank_name || operator_code

    // ─── TPIN Verification ───
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

    // ─── Retailer hierarchy ───
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
      console.warn('[Rechargekit Pay] Failed to fetch retailer hierarchy:', e)
    }

    // ─── Scheme resolution ───
    let serviceCharge = 0
    let resolvedSchemeId: string | null = null
    let resolvedSchemeName: string | null = null
    let resolvedVia: string | null = null
    let commissionSplit = { retailer_commission: 0, distributor_commission: 0, md_commission: 0 }
    const schemeCategory = 'Credit Card'

    try {
      const { data: schemeResult, error: schemeError } = await (supabaseAdmin as any).rpc(
        'resolve_scheme_for_user',
        { p_user_id: user.partner_id, p_user_role: user.role, p_service_type: 'bbps', p_distributor_id: distributorId, p_md_id: mdId }
      )

      if (schemeError) {
        console.error('[Rechargekit Pay] Scheme RPC error:', schemeError)
      } else if (schemeResult && schemeResult.length > 0) {
        const resolved = schemeResult[0]
        resolvedSchemeId = resolved.scheme_id
        resolvedSchemeName = resolved.scheme_name
        resolvedVia = resolved.resolved_via

        const { data: chargeResult, error: chargeError } = await (supabaseAdmin as any).rpc(
          'calculate_bbps_charge_from_scheme',
          { p_scheme_id: resolved.scheme_id, p_amount: amountNum, p_category: schemeCategory }
        )

        if (!chargeError && chargeResult?.length > 0 && parseFloat(chargeResult[0].retailer_charge) > 0) {
          serviceCharge = parseFloat(chargeResult[0].retailer_charge)
          commissionSplit = {
            retailer_commission: parseFloat(chargeResult[0].retailer_commission) || 0,
            distributor_commission: parseFloat(chargeResult[0].distributor_commission) || 0,
            md_commission: parseFloat(chargeResult[0].md_commission) || 0,
          }
        } else {
          const { data: slabs } = await (supabaseAdmin as any)
            .from('scheme_bbps_commissions')
            .select('*')
            .eq('scheme_id', resolved.scheme_id)
            .eq('status', 'active')
            .lte('min_amount', amountNum)
            .gte('max_amount', amountNum)
            .order('min_amount', { ascending: false })

          if (slabs?.length > 0) {
            const bestSlab = slabs.find((s: any) => {
              const sc = s.category
              return !sc || sc === '' || sc.toLowerCase() === 'all' || sc.toLowerCase() === 'all categories' || sc === schemeCategory
            })
            if (bestSlab) {
              const rc = parseFloat(bestSlab.retailer_charge) || 0
              serviceCharge = bestSlab.retailer_charge_type === 'percentage'
                ? Math.round((amountNum * rc) / 100 * 100) / 100
                : rc
              const calcComm = (val: number, type: string) =>
                type === 'percentage' ? Math.round((amountNum * val) / 100 * 100) / 100 : val
              commissionSplit = {
                retailer_commission: calcComm(parseFloat(bestSlab.retailer_commission) || 0, bestSlab.retailer_commission_type),
                distributor_commission: calcComm(parseFloat(bestSlab.distributor_commission) || 0, bestSlab.distributor_commission_type),
                md_commission: calcComm(parseFloat(bestSlab.md_commission) || 0, bestSlab.md_commission_type),
              }
            }
          }
        }
      }
    } catch (schemeErr) {
      console.error('[Rechargekit Pay] Scheme resolution failed:', schemeErr)
    }

    if (!serviceCharge || serviceCharge <= 0) {
      serviceCharge = RECHARGEKIT_DEFAULT_BASE_CHARGE
      if (!resolvedSchemeId) {
        console.warn(`[Rechargekit Pay] No scheme charge — using commercial fallback ₹${RECHARGEKIT_DEFAULT_BASE_CHARGE}`)
      }
    }

    const gstAmount = Math.round((serviceCharge * GST_PERCENT) / 100 * 100) / 100
    const totalServiceCharge = Math.round((serviceCharge + gstAmount) * 100) / 100
    const totalDebit = amountNum + totalServiceCharge

    // ─── Balance check ───
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

    const request_id = `RKCC${Date.now()}`

    // ─── Duplicate detection (5-min window) ───
    const idempotencyWindow = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const { data: existingTx } = await (supabaseAdmin as any)
      .from('bbps_transactions')
      .select('id, status, created_at')
      .eq('retailer_id', user.partner_id)
      .eq('consumer_number', cardMasked)
      .eq('bill_amount', amountNum)
      .neq('status', 'failed')
      .gte('created_at', idempotencyWindow)
      .limit(1)
      .maybeSingle()

    if (existingTx) {
      const response = NextResponse.json(
        { success: false, error: 'Duplicate payment detected. A payment for this card/amount was already submitted recently.', duplicate_transaction_id: existingTx.id },
        { status: 409 }
      )
      return addCorsHeaders(request, response)
    }

    // ─── Create transaction record in bbps_transactions ───
    const { data: txRecord, error: txInsertErr } = await (supabaseAdmin as any)
      .from('bbps_transactions')
      .insert({
        retailer_id: user.partner_id,
        biller_id: `RKCC_${operator_code}`,
        biller_name: bankLabel,
        consumer_number: cardMasked,
        consumer_name: beneficiary_name,
        bill_amount: amountNum,
        amount_paid: amountNum,
        agent_transaction_id: request_id,
        status: 'pending',
        additional_info: {
          provider: 'rechargekit',
          operator_code,
          ifsc: ifscCode,
          mobile: mobile,
          card_last4: cardDigits.slice(-4),
        },
        commission_amount: serviceCharge,
        ...(resolvedSchemeId ? { scheme_id: resolvedSchemeId, scheme_name: resolvedSchemeName, retailer_charge: serviceCharge } : {}),
      })
      .select()
      .single()

    if (txInsertErr || !txRecord) {
      console.error('[Rechargekit Pay] Failed to create transaction record:', txInsertErr)
      const response = NextResponse.json({ success: false, error: 'Failed to create transaction record' }, { status: 500 })
      return addCorsHeaders(request, response)
    }

    // ─── Wallet debit ───
    let debitErr: any = null
    if (user.role === 'partner') {
      const { error } = await (supabaseAdmin as any).rpc('debit_partner_wallet', {
        p_partner_id: user.partner_id,
        p_amount: totalDebit,
        p_description: `CC-2 ₹${amountNum} + ₹${totalServiceCharge} charge | ${bankLabel} | Card:${cardMasked}`,
        p_reference_id: request_id,
      })
      debitErr = error
    } else {
      const { error } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
        p_user_id: user.partner_id,
        p_user_role: user.role,
        p_wallet_type: 'primary',
        p_fund_category: 'service',
        p_service_type: 'rechargekit',
        p_tx_type: 'RECHARGEKIT_CC_DEBIT',
        p_credit: 0,
        p_debit: totalDebit,
        p_reference_id: request_id,
        p_transaction_id: txRecord.id,
        p_status: 'completed',
        p_remarks: `CC-2 ₹${amountNum} + ₹${totalServiceCharge} GST | ${bankLabel} | Card:${cardMasked} | Mob:${mobile}`,
      })
      debitErr = error
    }
    if (debitErr) {
      console.error('[Rechargekit Pay] Debit error:', debitErr)
      await (supabaseAdmin as any).from('bbps_transactions').update({ status: 'failed', error_message: 'Wallet debit failed: ' + (debitErr.message || 'unknown') }).eq('id', txRecord.id)
      const response = NextResponse.json({ success: false, error: 'Failed to debit wallet' }, { status: 500 })
      return addCorsHeaders(request, response)
    }

    // Mark wallet debited
    await (supabaseAdmin as any).from('bbps_transactions').update({ wallet_debited: true }).eq('id', txRecord.id)

    // ─── Refund helper ───
    const refund = async (reason: string) => {
      // Update transaction status
      await (supabaseAdmin as any).from('bbps_transactions').update({ status: 'failed', error_message: reason, completed_at: new Date().toISOString() }).eq('id', txRecord.id)

      if (user.role === 'partner') {
        const { error: refundErr } = await (supabaseAdmin as any).rpc('credit_partner_wallet', {
          p_partner_id: user.partner_id,
          p_amount: totalDebit,
          p_transaction_type: 'REFUND',
          p_description: `Refund ₹${totalDebit} | CC-2 ${bankLabel} | Card:${cardMasked} — ${reason}`,
          p_reference_id: `REFUND_${request_id}`,
        })
        if (refundErr) console.error('[Rechargekit Pay] CRITICAL refund failed:', refundErr)
      } else {
        const { error: refundErr } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
          p_user_id: user.partner_id,
          p_user_role: user.role,
          p_wallet_type: 'primary',
          p_fund_category: 'service',
          p_service_type: 'rechargekit',
          p_tx_type: 'RECHARGEKIT_CC_REFUND',
          p_credit: totalDebit,
          p_debit: 0,
          p_reference_id: `REFUND_${request_id}`,
          p_transaction_id: txRecord.id,
          p_status: 'completed',
          p_remarks: `Refund ₹${totalDebit} | CC-2 ${bankLabel} | Card:${cardMasked} | Mob:${mobile} — ${reason}`,
        })
        if (refundErr) console.error('[Rechargekit Pay] CRITICAL refund failed:', refundErr)
      }
    }

    // ─── Call Rechargekit provider ───
    let result
    try {
      result = await rechargekitCcPayment({
        mobile_no: mobile,
        account_no: cardDigits,
        ifsc: ifscCode,
        bank_name: String(bank_name).trim(),
        beneficiary_name: String(beneficiary_name).trim(),
        amount: amountNum,
        partner_request_id: request_id,
        operator_code: String(operator_code),
        transfer_type: transfer_type ? String(transfer_type) : undefined,
      })
    } catch (provErr: any) {
      await refund('provider error')
      const response = NextResponse.json(
        { success: false, error: provErr?.message || 'Credit card payment failed', request_id },
        { status: 200 }
      )
      return addCorsHeaders(request, response)
    }

    if (!result.success) {
      await refund(result.error || 'payment failed')
      const response = NextResponse.json(
        { success: false, error: result.error, request_id, provider_status: result.providerStatus },
        { status: 200 }
      )
      return addCorsHeaders(request, response)
    }

    // ─── Pending: keep debit, update transaction status ───
    if (result.pending) {
      await (supabaseAdmin as any).from('bbps_transactions').update({
        status: 'pending',
        transaction_id: result.txn_id,
        payment_status: 'pending',
        additional_info: {
          ...(txRecord.additional_info || {}),
          provider_txn_id: result.txn_id,
          operator_reference: result.operator_reference,
          provider_message: result.message,
        },
      }).eq('id', txRecord.id)

      const response = NextResponse.json({
        success: true,
        pending: true,
        order_id: result.txn_id,
        operator_reference: result.operator_reference,
        amount: amountNum,
        charge: totalServiceCharge,
        request_id,
        message: result.message || 'Payment is pending with provider',
      })
      return addCorsHeaders(request, response)
    }

    // ─── Success: update transaction + distribute commissions ───
    await (supabaseAdmin as any).from('bbps_transactions').update({
      status: 'success',
      transaction_id: result.txn_id,
      payment_status: 'success',
      completed_at: new Date().toISOString(),
      additional_info: {
        ...(txRecord.additional_info || {}),
        provider_txn_id: result.txn_id,
        operator_reference: result.operator_reference,
        provider_message: result.message,
      },
    }).eq('id', txRecord.id)

    if (serviceCharge > 0) {
      const txRef = `RKCC_COMM_${request_id}`
      try {
        if (commissionSplit.retailer_commission > 0) {
          await (supabaseAdmin as any).rpc('add_ledger_entry', {
            p_user_id: user.partner_id,
            p_user_role: user.role,
            p_wallet_type: 'primary',
            p_fund_category: 'commission',
            p_service_type: 'rechargekit',
            p_tx_type: 'COMMISSION_CREDIT',
            p_credit: commissionSplit.retailer_commission,
            p_debit: 0,
            p_reference_id: txRef,
            p_transaction_id: txRecord.id,
            p_status: 'completed',
            p_remarks: `Commission on CC-2 Bill ₹${amountNum} - ${bankLabel}`,
          })
        }

        const skipDtCommission = resolvedVia === 'distributor_mapping'
        const skipMdCommission = resolvedVia === 'md_mapping'

        if (commissionSplit.distributor_commission > 0 && distributorId && !skipDtCommission) {
          await (supabaseAdmin as any).rpc('add_ledger_entry', {
            p_user_id: distributorId,
            p_user_role: 'distributor',
            p_wallet_type: 'primary',
            p_fund_category: 'commission',
            p_service_type: 'rechargekit',
            p_tx_type: 'COMMISSION_CREDIT',
            p_credit: commissionSplit.distributor_commission,
            p_debit: 0,
            p_reference_id: txRef,
            p_status: 'completed',
            p_remarks: `DT commission on CC-2 Bill ₹${amountNum} - ${bankLabel} (RT:${user.partner_id})`,
          })
        }

        if (commissionSplit.md_commission > 0 && mdId && !skipMdCommission) {
          await (supabaseAdmin as any).rpc('add_ledger_entry', {
            p_user_id: mdId,
            p_user_role: 'master_distributor',
            p_wallet_type: 'primary',
            p_fund_category: 'commission',
            p_service_type: 'rechargekit',
            p_tx_type: 'COMMISSION_CREDIT',
            p_credit: commissionSplit.md_commission,
            p_debit: 0,
            p_reference_id: txRef,
            p_status: 'completed',
            p_remarks: `MD commission on CC-2 Bill ₹${amountNum} - ${bankLabel} (RT:${user.partner_id})`,
          })
        }

        const companyEarning =
          totalServiceCharge -
          commissionSplit.retailer_commission -
          (!skipDtCommission && distributorId ? commissionSplit.distributor_commission : 0) -
          (!skipMdCommission && mdId ? commissionSplit.md_commission : 0)
        if (companyEarning > 0) {
          const revenueUserId = process.env.SUBSCRIPTION_REVENUE_USER_ID
          const revenueUserRole = process.env.SUBSCRIPTION_REVENUE_USER_ROLE || 'master_distributor'
          if (revenueUserId) {
            await (supabaseAdmin as any).rpc('add_ledger_entry', {
              p_user_id: revenueUserId,
              p_user_role: revenueUserRole,
              p_wallet_type: 'primary',
              p_fund_category: 'revenue',
              p_service_type: 'rechargekit',
              p_tx_type: 'REVENUE_CREDIT',
              p_credit: companyEarning,
              p_debit: 0,
              p_reference_id: txRef,
              p_status: 'completed',
              p_remarks: `Revenue from CC-2 Bill charge ₹${totalServiceCharge} on ₹${amountNum} - ${bankLabel} (RT:${user.partner_id})`,
            })
          }
        }
      } catch (commErr: any) {
        console.error('[Rechargekit Pay] Commission distribution error (non-fatal):', commErr.message)
      }
    }

    const response = NextResponse.json({
      success: true,
      pending: false,
      order_id: result.txn_id,
      operator_reference: result.operator_reference,
      amount: amountNum,
      charge: totalServiceCharge,
      request_id,
      bbps_transaction_id: txRecord.id,
      message: result.message,
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[Rechargekit Pay] Error:', error)
    const response = NextResponse.json(
      { success: false, error: error.message || 'Credit card payment failed' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
