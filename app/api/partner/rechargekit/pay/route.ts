import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { rechargekitCcPayment } from '@/services/rechargekit/ccPayment'

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
    const access = partnerCanUseApi(partner, 'rechargekit')
    if (!access.allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'SERVICE_NOT_ENABLED', message: access.message } },
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
      mobile_no, account_no, ifsc, bank_name,
      beneficiary_name, amount, operator_code, transfer_type,
    } = body

    if (!mobile_no || !account_no || !ifsc || !bank_name || !beneficiary_name || !amount || !operator_code) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'All fields required: mobile_no, account_no, ifsc, bank_name, beneficiary_name, amount, operator_code',
          },
        },
        { status: 400 }
      )
    }

    if (!/^\d{10}$/.test(String(mobile_no))) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'mobile_no must be a 10-digit number' } },
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

    // Resolve scheme charges for partner
    let serviceCharge = 0
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
        console.error('[Partner Rechargekit Pay] Scheme RPC error:', schemeError)
      } else if (schemeResult && schemeResult.length > 0) {
        const resolved = schemeResult[0]

        const { data: chargeResult, error: chargeError } = await (supabase as any).rpc('calculate_bbps_charge_from_scheme', {
          p_scheme_id: resolved.scheme_id,
          p_amount: amountNum,
          p_category: schemeCategory,
        })

        if (chargeError) {
          console.error('[Partner Rechargekit Pay] Charge calculation error:', chargeError)
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
      console.error('[Partner Rechargekit Pay] Scheme resolution failed:', schemeErr)
    }

    const gstAmount = Math.round(serviceCharge * GST_PERCENT / 100 * 100) / 100
    const totalServiceCharge = Math.round((serviceCharge + gstAmount) * 100) / 100
    const totalDebit = amountNum + totalServiceCharge

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

    if ((walletBalance || 0) < totalDebit) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient partner wallet balance' },
          wallet_balance: walletBalance || 0,
          bill_amount: amountNum,
          charge: totalServiceCharge,
          required_amount: totalDebit,
        },
        { status: 400 }
      )
    }

    const maskedCard = account_no.length > 4 ? `****${account_no.slice(-4)}` : account_no
    const request_id = `RKCC${Date.now()}`

    // Debit partner wallet BEFORE calling provider
    const { error: debitErr } = await supabase.rpc('debit_partner_wallet', {
      p_partner_id: partner.id,
      p_amount: totalDebit,
      p_payout_transaction_id: null,
      p_description: `CC-2 (RechargeKit) ₹${amountNum} + ₹${totalServiceCharge} charge | ${bank_name} | Card:${maskedCard} | Mob:${mobile_no}`,
      p_reference_id: request_id,
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
        p_description: `CC-2 refund ₹${totalDebit} | ${bank_name} | Card:${maskedCard} — ${reason}`,
        p_reference_id: `REFUND_${request_id}`,
      })
      if (refundErr) console.error('[Partner Rechargekit Pay] CRITICAL refund failed:', refundErr)
    }

    let result
    try {
      result = await rechargekitCcPayment({
        mobile_no: String(mobile_no),
        account_no: String(account_no),
        ifsc: String(ifsc),
        bank_name: String(bank_name),
        beneficiary_name: String(beneficiary_name),
        amount: amountNum,
        partner_request_id: request_id,
        operator_code: String(operator_code),
        transfer_type: transfer_type ? String(transfer_type) : undefined,
      })
    } catch (provErr: any) {
      await refund('provider error')
      await supabase
        .from('partner_wallet_ledger')
        .update({ payout_transaction_id: `FAILED:${request_id}` })
        .eq('partner_id', partner.id)
        .eq('reference_id', request_id)
        .is('payout_transaction_id', null)
      return NextResponse.json(
        { success: false, error: { code: 'PROVIDER_ERROR', message: provErr?.message || 'CC payment failed' }, request_id },
        { status: 200 }
      )
    }

    if (!result.success) {
      await refund(result.error || 'payment failed')
      await supabase
        .from('partner_wallet_ledger')
        .update({ payout_transaction_id: `FAILED:${request_id}` })
        .eq('partner_id', partner.id)
        .eq('reference_id', request_id)
        .is('payout_transaction_id', null)
      return NextResponse.json(
        {
          success: false,
          error: { code: 'PAYMENT_FAILED', message: result.error || 'Payment failed' },
          refunded: true,
          refund_amount: totalDebit,
          request_id,
        },
        { status: 200 }
      )
    }

    // Pending or success
    const status = result.pending ? 'PENDING' : 'SUCCESS'
    const txnId = result.txn_id || request_id

    // Store txn_id in ledger for status lookups
    await supabase
      .from('partner_wallet_ledger')
      .update({
        payout_transaction_id: txnId,
        description: `CC-2 (RechargeKit) ₹${amountNum} + ₹${totalServiceCharge} charge | ${bank_name} | Card:${maskedCard} | Mob:${mobile_no} | TxnID:${txnId} | Ref:${result.operator_reference || 'N/A'}`,
      })
      .eq('partner_id', partner.id)
      .eq('reference_id', request_id)
      .is('payout_transaction_id', null)

    return NextResponse.json({
      success: true,
      status,
      txn_id: txnId,
      operator_reference: result.operator_reference || null,
      amount: amountNum,
      charge: totalServiceCharge,
      request_id,
      message: result.message || (result.pending ? 'Payment is being processed' : 'Payment successful'),
    })
  } catch (error: any) {
    console.error('[Partner Rechargekit Pay] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
