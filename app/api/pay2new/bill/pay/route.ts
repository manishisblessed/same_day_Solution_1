import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { pay2newPayBill } from '@/services/pay2new'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { createClient } from '@supabase/supabase-js'
import { fetchBillerInfo, fetchBill, payRequest } from '@/services/bbps'
import { generateAgentTransactionId } from '@/services/bbps/helpers'
import { distributeServiceCommission } from '@/lib/commission/distribute-service-commission'

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

    if (!user) {
      const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      return addCorsHeaders(request, response)
    }

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

    const { number, amount, product_code, product_name, bill_fetch_ref, optional1, optional2, optional3, optional4, customer_number, customer_name, pincode, tpin, use_bbps, biller_id: frontendBillerId } = body

    if (!number || !amount || !product_code || !bill_fetch_ref || !customer_number) {
      const response = NextResponse.json(
        { success: false, error: 'Missing required fields: number, amount, product_code, bill_fetch_ref, customer_number' },
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

    const supabaseAdmin = getSupabaseAdmin()

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
    let chargeModelData: { md_purchase_charge: number; dt_purchase_charge: number; rt_purchase_charge: number; company_cost: number } | null = null
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
              const rc = parseFloat(bestSlab.retailer_charge) || 0
              serviceCharge = bestSlab.retailer_charge_type === 'percentage'
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

    if (!resolvedSchemeId) {
      console.warn(`[Pay2New Bill Pay] No scheme resolved for user=${user.partner_id} — charge will be ₹0`)
      serviceCharge = 0
    }

    // Add 18% GST on service charge
    const GST_PERCENT = 18
    const gstAmount = Math.round(serviceCharge * GST_PERCENT / 100 * 100) / 100
    const totalServiceCharge = Math.round((serviceCharge + gstAmount) * 100) / 100
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

    // Debit total (bill + charge) from wallet BEFORE calling provider
    let debitErr: any = null
    if (user.role === 'partner') {
      const { error } = await (supabaseAdmin as any).rpc('debit_partner_wallet', {
        p_partner_id: user.partner_id,
        p_amount: totalDebit,
        p_description: `CC ₹${amountNum} + ₹${totalServiceCharge} charge | ${product_name || product_code} | Card:${number}${customer_name ? ` | Name:${customer_name}` : ''}`,
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
        p_remarks: `CC ₹${amountNum} + ₹${totalServiceCharge} GST | ${product_name || product_code} | Card:${number} | Mob:${customer_number}${customer_name ? ` | Name:${customer_name}` : ''}`,
      })
      debitErr = error
    }
    if (debitErr) {
      console.error('[Pay2New Bill Pay] Debit error:', debitErr)
      const response = NextResponse.json({ success: false, error: 'Failed to debit wallet' }, { status: 500 })
      return addCorsHeaders(request, response)
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
          { success: false, error: bbpsResult.error_message || 'Payment failed', request_id },
          { status: 200 }
        )
        return addCorsHeaders(request, response)
      } catch (bbpsErr: any) {
        console.error('[Pay2New→BBPS Direct] Error:', bbpsErr.message)
        await refund(bbpsErr.message || 'BBPS payment error')
        const response = NextResponse.json(
          { success: false, error: bbpsErr.message || 'Payment failed', request_id },
          { status: 200 }
        )
        return addCorsHeaders(request, response)
      }
    }

    let result
    try {
      result = await pay2newPayBill({
        number,
        amount: amountNum,
        product_code: String(product_code),
        request_id,
        bill_fetch_ref,
        optional1: optional1 || '',
        optional2: optional2 || '',
        optional3: optional3 || '',
        optional4: optional4 || '',
        customer_number,
        pincode: pincode || '414002',
      })
    } catch (provErr: any) {
      await refund('provider error')
      const response = NextResponse.json(
        { success: false, error: provErr?.message || 'Bill payment failed', request_id },
        { status: 200 }
      )
      return addCorsHeaders(request, response)
    }

    if (!result.success) {
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

      await refund(result.error || 'payment failed')
      const response = NextResponse.json(
        { success: false, error: result.error, request_id },
        { status: 200 }
      )
      return addCorsHeaders(request, response)
    }

    // Payment succeeded — per-transaction commission: retailer + distributor only
    // (no MD). MD's former slice folds into company revenue. Idempotent references.
    if (totalServiceCharge > 0) {
      const commResult = await distributeServiceCommission({
        supabase: supabaseAdmin,
        service: 'pay2new',
        refPrefix: 'P2N',
        refKey: request_id,
        totalCharge: totalServiceCharge,
        retailer: { id: user.partner_id, role: user.role, commission: commissionSplit.retailer_commission },
        distributor: { id: distributorId, commission: commissionSplit.distributor_commission },
        masterDistributor: { id: mdId },
        chargeModel: chargeModelData,
        remarksSuffix: `on CC Bill ₹${amountNum} - ${product_name || product_code}`,
      })
      if (commResult.errors.length) console.error('[Pay2New Bill Pay] Commission errors:', commResult.errors)
    }

    const response = NextResponse.json({
      success: true,
      order_id: result.order_id,
      operator_reference: result.operator_reference,
      amount: result.amount,
      charge: totalServiceCharge,
      request_id,
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[Pay2New Bill Pay] Error:', error)
    const response = NextResponse.json(
      { success: false, error: error.message || 'Bill payment failed' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
