import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { pay2newPayBill } from '@/services/pay2new'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const GST_PERCENT = 18

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
      retailer_id, number, amount, product_code, product_name,
      bill_fetch_ref, customer_number,
      optional1, optional2, optional3, optional4, pincode,
    } = body

    if (!retailer_id) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'retailer_id is required' } },
        { status: 400 }
      )
    }
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

    // Verify retailer exists
    const { data: retailer } = await supabase
      .from('retailers')
      .select('partner_id, name, email, distributor_id, master_distributor_id')
      .eq('partner_id', retailer_id)
      .maybeSingle()

    if (!retailer) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Retailer not found' } },
        { status: 404 }
      )
    }

    // Ownership check: retailer must be linked to this partner
    const { data: partnerRetailerLink } = await supabase
      .from('partner_retailers')
      .select('id')
      .eq('partner_id', partner.id)
      .eq('retailer_code', retailer_id)
      .maybeSingle()

    if (!partnerRetailerLink) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Retailer is not linked to your partner account' } },
        { status: 403 }
      )
    }

    // Resolve scheme charges (uses BBPS scheme with "Credit Card" category)
    let serviceCharge = 0
    let resolvedSchemeId: string | null = null
    let resolvedSchemeName: string | null = null
    let resolvedVia: string | null = null
    let commissionSplit = { retailer_commission: 0, distributor_commission: 0, md_commission: 0 }
    const schemeCategory = 'Credit Card'

    try {
      const { data: schemeResult, error: schemeError } = await (supabase as any).rpc('resolve_scheme_for_user', {
        p_user_id: retailer_id,
        p_user_role: 'retailer',
        p_service_type: 'bbps',
        p_distributor_id: retailer.distributor_id || null,
        p_md_id: retailer.master_distributor_id || null,
      })

      if (schemeError) {
        console.error('[Partner Pay2New Pay] Scheme RPC error:', schemeError)
      } else if (schemeResult && schemeResult.length > 0) {
        const resolved = schemeResult[0]
        resolvedSchemeId = resolved.scheme_id
        resolvedSchemeName = resolved.scheme_name
        resolvedVia = resolved.resolved_via

        const { data: chargeResult, error: chargeError } = await (supabase as any).rpc('calculate_bbps_charge_from_scheme', {
          p_scheme_id: resolved.scheme_id,
          p_amount: amountNum,
          p_category: schemeCategory,
        })

        if (chargeError) {
          console.error('[Partner Pay2New Pay] Charge calculation error:', chargeError)
        } else if (chargeResult && chargeResult.length > 0 && parseFloat(chargeResult[0].retailer_charge) > 0) {
          serviceCharge = parseFloat(chargeResult[0].retailer_charge)
          commissionSplit = {
            retailer_commission: parseFloat(chargeResult[0].retailer_commission) || 0,
            distributor_commission: parseFloat(chargeResult[0].distributor_commission) || 0,
            md_commission: parseFloat(chargeResult[0].md_commission) || 0,
          }
        } else {
          // Fallback: direct slab query
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
              const calcComm = (val: number, type: string) => type === 'percentage' ? Math.round(amountNum * val / 100 * 100) / 100 : val
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
      console.error('[Partner Pay2New Pay] Scheme resolution failed:', schemeErr)
    }

    if (!resolvedSchemeId) {
      console.warn(`[Partner Pay2New Pay] No scheme resolved for retailer=${retailer_id} — charge will be ₹0`)
      serviceCharge = 0
    }

    const gstAmount = Math.round(serviceCharge * GST_PERCENT / 100 * 100) / 100
    const totalServiceCharge = Math.round((serviceCharge + gstAmount) * 100) / 100
    const totalDebit = amountNum + totalServiceCharge

    // Balance check
    const { data: walletBalance, error: balErr } = await (supabase as any).rpc('get_wallet_balance', {
      p_retailer_id: retailer_id,
    })
    if (balErr) {
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to check wallet balance' } },
        { status: 500 }
      )
    }
    if ((walletBalance || 0) < totalDebit) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient wallet balance' },
          wallet_balance: walletBalance || 0, bill_amount: amountNum, charge: totalServiceCharge, required_amount: totalDebit,
        },
        { status: 400 }
      )
    }

    const request_id = `SDS${Date.now()}`

    // Debit wallet BEFORE calling provider
    const { error: debitErr } = await (supabase as any).rpc('add_ledger_entry', {
      p_user_id: retailer_id,
      p_user_role: 'retailer',
      p_wallet_type: 'primary',
      p_fund_category: 'service',
      p_service_type: 'pay2new',
      p_tx_type: 'PAY2NEW_DEBIT',
      p_credit: 0,
      p_debit: totalDebit,
      p_reference_id: request_id,
      p_status: 'completed',
      p_remarks: `Partner CC ₹${amountNum} + ₹${totalServiceCharge} GST | ${product_name || product_code} | Card:${number} | Mob:${customer_number}`,
    })
    if (debitErr) {
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to debit wallet' } },
        { status: 500 }
      )
    }

    const refund = async (reason: string) => {
      const { error: refundErr } = await (supabase as any).rpc('add_ledger_entry', {
        p_user_id: retailer_id, p_user_role: 'retailer', p_wallet_type: 'primary',
        p_fund_category: 'service', p_service_type: 'pay2new', p_tx_type: 'PAY2NEW_REFUND',
        p_credit: totalDebit, p_debit: 0,
        p_reference_id: `REFUND_${request_id}`, p_status: 'completed',
        p_remarks: `Partner refund ₹${totalDebit} | ${product_name || product_code} | Card:${number} | Mob:${customer_number} — ${reason}`,
      })
      if (refundErr) console.error('[Partner Pay2New Pay] CRITICAL refund failed:', refundErr)
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
      return NextResponse.json(
        { success: false, error: { code: 'PROVIDER_ERROR', message: provErr?.message || 'Bill payment failed' }, request_id },
        { status: 200 }
      )
    }

    if (!result.success) {
      await refund(result.error || 'payment failed')
      return NextResponse.json(
        { success: false, error: { code: 'PAYMENT_FAILED', message: result.error || 'Payment failed' }, request_id },
        { status: 200 }
      )
    }

    // Payment succeeded — distribute commissions
    if (serviceCharge > 0) {
      const txRef = `P2N_COMM_${request_id}`
      try {
        if (commissionSplit.retailer_commission > 0) {
          await (supabase as any).rpc('add_ledger_entry', {
            p_user_id: retailer_id, p_user_role: 'retailer', p_wallet_type: 'primary',
            p_fund_category: 'commission', p_service_type: 'pay2new', p_tx_type: 'COMMISSION_CREDIT',
            p_credit: commissionSplit.retailer_commission, p_debit: 0,
            p_reference_id: txRef, p_status: 'completed',
            p_remarks: `Commission on CC Bill ₹${amountNum} - ${product_name || product_code}`,
          })
        }

        const distributorId = retailer.distributor_id || null
        const mdId = retailer.master_distributor_id || null
        const skipDtCommission = resolvedVia === 'distributor_mapping'
        const skipMdCommission = resolvedVia === 'md_mapping'

        if (commissionSplit.distributor_commission > 0 && distributorId && !skipDtCommission) {
          await (supabase as any).rpc('add_ledger_entry', {
            p_user_id: distributorId, p_user_role: 'distributor', p_wallet_type: 'primary',
            p_fund_category: 'commission', p_service_type: 'pay2new', p_tx_type: 'COMMISSION_CREDIT',
            p_credit: commissionSplit.distributor_commission, p_debit: 0,
            p_reference_id: txRef, p_status: 'completed',
            p_remarks: `DT commission on CC Bill ₹${amountNum} - ${product_name || product_code} (RT:${retailer_id})`,
          })
        }

        if (commissionSplit.md_commission > 0 && mdId && !skipMdCommission) {
          await (supabase as any).rpc('add_ledger_entry', {
            p_user_id: mdId, p_user_role: 'master_distributor', p_wallet_type: 'primary',
            p_fund_category: 'commission', p_service_type: 'pay2new', p_tx_type: 'COMMISSION_CREDIT',
            p_credit: commissionSplit.md_commission, p_debit: 0,
            p_reference_id: txRef, p_status: 'completed',
            p_remarks: `MD commission on CC Bill ₹${amountNum} - ${product_name || product_code} (RT:${retailer_id})`,
          })
        }

        const companyEarning = totalServiceCharge - commissionSplit.retailer_commission
          - ((!skipDtCommission && distributorId) ? commissionSplit.distributor_commission : 0)
          - ((!skipMdCommission && mdId) ? commissionSplit.md_commission : 0)
        if (companyEarning > 0) {
          const revenueUserId = process.env.SUBSCRIPTION_REVENUE_USER_ID
          const revenueUserRole = process.env.SUBSCRIPTION_REVENUE_USER_ROLE || 'master_distributor'
          if (revenueUserId) {
            await (supabase as any).rpc('add_ledger_entry', {
              p_user_id: revenueUserId, p_user_role: revenueUserRole, p_wallet_type: 'primary',
              p_fund_category: 'revenue', p_service_type: 'pay2new', p_tx_type: 'REVENUE_CREDIT',
              p_credit: companyEarning, p_debit: 0,
              p_reference_id: txRef, p_status: 'completed',
              p_remarks: `Revenue from CC Bill charge ₹${totalServiceCharge} on ₹${amountNum} - ${product_name || product_code} (RT:${retailer_id})`,
            })
          }
        }
      } catch (commErr: any) {
        console.error('[Partner Pay2New Pay] Commission distribution error (non-fatal):', commErr.message)
      }
    }

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
