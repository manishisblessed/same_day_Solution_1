import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError } from '@/lib/partner-auth'
import { payRequest, generateAgentTransactionId, getBBPSWalletBalance } from '@/services/bbps'
import { paiseToRupees } from '@/lib/bbps/currency'

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
    if (!partner.permissions.includes('bbps') && !partner.permissions.includes('all')) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Missing required permission: bbps' } },
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
      retailer_id, biller_id, biller_name, consumer_number, amount,
      consumer_name, due_date, bill_date, bill_number, additional_info,
      biller_category, reqId, payment_mode, pan_number,
    } = body

    if (!retailer_id) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'retailer_id is required' } },
        { status: 400 }
      )
    }
    if (!biller_id || !consumer_number || !amount) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'biller_id, consumer_number, and amount are required' } },
        { status: 400 }
      )
    }
    if (!biller_name || biller_name.trim() === '') {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'biller_name is required' } },
        { status: 400 }
      )
    }

    const supabase = getSupabase()

    // Verify retailer exists and belongs to this partner
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

    // PAN required for payments above 49999 rupees
    const billAmountInPaise = parseFloat(amount)
    if (isNaN(billAmountInPaise) || billAmountInPaise <= 0) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid amount' } },
        { status: 400 }
      )
    }
    const billAmountInRupees = paiseToRupees(billAmountInPaise)

    if (billAmountInRupees > 49999) {
      if (!pan_number || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test((pan_number || '').trim().toUpperCase())) {
        return NextResponse.json(
          { success: false, error: { code: 'BAD_REQUEST', message: 'Valid PAN required for payments above ₹49,999' }, pan_required: true },
          { status: 400 }
        )
      }
    }

    // Check SparkUpTech provider balance
    const providerBalance = await getBBPSWalletBalance()
    if (!providerBalance.success) {
      return NextResponse.json(
        { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'BBPS service temporarily unavailable' } },
        { status: 503 }
      )
    }
    const availableProviderBalance = (providerBalance.balance || 0) - (providerBalance.lien || 0)
    if (availableProviderBalance < billAmountInRupees) {
      return NextResponse.json(
        { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'BBPS provider balance insufficient. Contact admin.' } },
        { status: 503 }
      )
    }

    // Check retailer wallet
    const { data: walletBalance, error: balErr } = await (supabase as any).rpc('get_wallet_balance', {
      p_retailer_id: retailer_id,
    })
    if (balErr) {
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to check wallet balance' } },
        { status: 500 }
      )
    }

    // Resolve scheme charges
    let bbpsCharge = 20
    let resolvedSchemeId: string | null = null
    let resolvedSchemeName: string | null = null
    try {
      const { data: schemeResult } = await (supabase as any).rpc('resolve_scheme_for_user', {
        p_user_id: retailer_id,
        p_user_role: 'retailer',
        p_service_type: 'bbps',
        p_distributor_id: retailer.distributor_id || null,
        p_md_id: retailer.master_distributor_id || null,
      })
      if (schemeResult?.[0]) {
        resolvedSchemeId = schemeResult[0].scheme_id
        resolvedSchemeName = schemeResult[0].scheme_name
        const { data: chargeResult } = await (supabase as any).rpc('calculate_bbps_charge_from_scheme', {
          p_scheme_id: schemeResult[0].scheme_id,
          p_amount: billAmountInRupees,
          p_category: additional_info?.category || null,
        })
        if (chargeResult?.[0] && parseFloat(chargeResult[0].retailer_charge) > 0) {
          bbpsCharge = parseFloat(chargeResult[0].retailer_charge)
        }
      }
    } catch { /* use default charge */ }

    const totalAmountNeeded = billAmountInRupees + bbpsCharge
    if (walletBalance < totalAmountNeeded) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient wallet balance' },
          wallet_balance: walletBalance, bill_amount: billAmountInRupees, charge: bbpsCharge, required_amount: totalAmountNeeded,
        },
        { status: 400 }
      )
    }

    const agentTransactionId = generateAgentTransactionId(retailer_id)

    // Create transaction record
    const { data: bbpsTx, error: txErr } = await supabase
      .from('bbps_transactions')
      .insert({
        retailer_id, biller_id, biller_name, consumer_number, consumer_name,
        bill_amount: billAmountInRupees, amount_paid: billAmountInRupees,
        agent_transaction_id: agentTransactionId, status: 'pending',
        due_date: due_date || null, bill_date: bill_date || null, bill_number: bill_number || null,
        additional_info: additional_info || {},
        ...(pan_number ? { pan_number: pan_number.trim().toUpperCase() } : {}),
        ...(resolvedSchemeId ? { scheme_id: resolvedSchemeId, scheme_name: resolvedSchemeName, retailer_charge: bbpsCharge } : {}),
      })
      .select()
      .single()

    if (txErr || !bbpsTx) {
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create transaction record' } },
        { status: 500 }
      )
    }

    // Debit retailer wallet
    const { data: ledgerId, error: debitErr } = await supabase.rpc('add_ledger_entry', {
      p_user_id: retailer_id, p_user_role: 'retailer', p_wallet_type: 'primary',
      p_fund_category: 'bbps', p_service_type: 'bbps', p_tx_type: 'BBPS_DEBIT',
      p_credit: 0, p_debit: totalAmountNeeded,
      p_reference_id: agentTransactionId, p_transaction_id: bbpsTx.id,
      p_status: 'completed',
      p_remarks: `BBPS Partner Payment - ${biller_name} - ${consumer_number} (Bill: ₹${billAmountInRupees}, Charge: ₹${bbpsCharge})`,
    })

    if (debitErr) {
      await supabase.from('bbps_transactions').update({ status: 'failed', error_message: debitErr.message }).eq('id', bbpsTx.id)
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to debit wallet' } },
        { status: 500 }
      )
    }

    await supabase.from('bbps_transactions').update({ wallet_debited: true, wallet_debit_id: ledgerId }).eq('id', bbpsTx.id)

    // Build inputParams for SparkUpTech
    let inputParams: Array<{ paramName: string; paramValue: string }> = []
    const provided = additional_info?.inputParams
    if (Array.isArray(provided)) {
      inputParams = provided.filter((p: any) => p?.paramName).map((p: any) => ({ paramName: p.paramName.trim(), paramValue: String(p.paramValue || '') }))
    }
    if (inputParams.length === 0) {
      inputParams = [{ paramName: 'Consumer Number', paramValue: consumer_number }]
    }

    const subServiceName = biller_category || additional_info?.category || 'Credit Card'
    const billerResponse = additional_info?.billerResponse
    let additionalInfoArray: Array<{ infoName: string; infoValue: string }> | undefined
    const rawAI = additional_info?.additionalInfo
    if (Array.isArray(rawAI)) {
      additionalInfoArray = rawAI.filter((i: any) => i?.infoName).map((i: any) => ({ infoName: String(i.infoName), infoValue: String(i.infoValue || '') }))
    } else if (rawAI?.info && Array.isArray(rawAI.info)) {
      additionalInfoArray = rawAI.info.filter((i: any) => i?.infoName).map((i: any) => ({ infoName: String(i.infoName), infoValue: String(i.infoValue || '') }))
    }

    // Call SparkUpTech payRequest
    const paymentResponse = await payRequest({
      billerId: biller_id, billerName: biller_name, consumerNumber: consumer_number,
      amount: billAmountInRupees, agentTransactionId, inputParams,
      subServiceName, custConvFee: 1, billerAdhoc: true,
      paymentInfo: [{ infoName: 'Payment Account Info', infoValue: 'Cash Payment' }],
      paymentMode: payment_mode || 'Cash', quickPay: 'N',
      reqId: reqId || additional_info?.reqId,
      billerResponse, additionalInfo: additionalInfoArray,
    })

    // Update transaction
    const updateData: any = { payment_status: paymentResponse.payment_status || paymentResponse.status, updated_at: new Date().toISOString() }
    if (paymentResponse.success && paymentResponse.transaction_id) {
      updateData.transaction_id = paymentResponse.transaction_id
      updateData.status = 'success'
      updateData.completed_at = new Date().toISOString()
    } else {
      updateData.status = 'failed'
      updateData.error_code = paymentResponse.error_code
      updateData.error_message = paymentResponse.error_message
      // Refund on failure
      try {
        await supabase.rpc('add_ledger_entry', {
          p_user_id: retailer_id, p_user_role: 'retailer', p_wallet_type: 'primary',
          p_fund_category: 'bbps', p_service_type: 'bbps', p_tx_type: 'BBPS_REFUND',
          p_credit: totalAmountNeeded, p_debit: 0,
          p_reference_id: `REFUND_${agentTransactionId}`, p_transaction_id: bbpsTx.id,
          p_status: 'completed',
          p_remarks: `BBPS Partner Payment Refund - ${paymentResponse.error_message || 'Payment failed'}`,
        })
      } catch (refErr) {
        console.error('[Partner BBPS Pay] Refund failed:', refErr)
        updateData.error_message = (updateData.error_message || '') + ' [REFUND_FAILED: Manual review required]'
      }
    }
    await supabase.from('bbps_transactions').update(updateData).eq('id', bbpsTx.id)

    return NextResponse.json({
      success: paymentResponse.success,
      transaction_id: bbpsTx.id,
      agent_transaction_id: agentTransactionId,
      bbps_transaction_id: paymentResponse.transaction_id,
      status: updateData.status,
      payment_status: updateData.payment_status,
      error_code: paymentResponse.error_code,
      error_message: paymentResponse.error_message,
    })
  } catch (error: any) {
    console.error('[Partner BBPS Pay] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
