import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

/**
 * POST /api/rechargekit/callback
 * Rechargekit calls this URL when a pending transaction status changes.
 * Expected payload: { partner_request_id, status, orderid, optransid, commission, msg }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      partner_request_id,
      order_id,
      orderid,
      status,
      optransid,
      commission,
      msg,
      message,
    } = body

    const requestId = partner_request_id || order_id || orderid
    const providerStatus = Number(status)
    const operatorRef = optransid || ''
    const providerMsg = msg || message || ''

    console.log(`[Rechargekit Callback] request_id=${requestId} status=${providerStatus} optransid=${operatorRef}`)

    if (!requestId) {
      return NextResponse.json({ error: 'Missing partner_request_id' }, { status: 400 })
    }

    const supabaseAdmin = getSupabaseAdmin()

    const { data: tx, error: txErr } = await supabaseAdmin
      .from('bbps_transactions')
      .select('id, status, retailer_id, bill_amount, additional_info, scheme_id')
      .eq('agent_transaction_id', requestId)
      .maybeSingle()

    if (txErr || !tx) {
      console.error('[Rechargekit Callback] Transaction not found:', requestId, txErr)
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }

    if (tx.status === 'success' || tx.status === 'failed') {
      console.log(`[Rechargekit Callback] Transaction ${requestId} already finalized: ${tx.status}`)
      return NextResponse.json({ ok: true, message: 'Already finalized', status: tx.status })
    }

    const updatedInfo = { ...(tx.additional_info || {}), provider_txn_id: orderid || requestId, operator_reference: operatorRef, callback_status: providerStatus, callback_msg: providerMsg }

    if (providerStatus === 1) {
      // SUCCESS
      await supabaseAdmin.from('bbps_transactions').update({
        status: 'success',
        payment_status: 'success',
        transaction_id: orderid || requestId,
        completed_at: new Date().toISOString(),
        additional_info: updatedInfo,
      }).eq('id', tx.id)

      // Distribute commissions for successful payment
      try {
        const { data: retailerData } = await supabaseAdmin
          .from('retailers')
          .select('distributor_id, master_distributor_id')
          .eq('partner_id', tx.retailer_id)
          .maybeSingle()

        const distributorId = retailerData?.distributor_id || null
        const mdId = retailerData?.master_distributor_id || null

        if (tx.scheme_id) {
          const { data: chargeResult } = await supabaseAdmin.rpc(
            'calculate_bbps_charge_from_scheme',
            { p_scheme_id: tx.scheme_id, p_amount: tx.bill_amount, p_category: 'Credit Card' }
          )
          if (chargeResult?.length > 0) {
            const commSplit = {
              retailer_commission: parseFloat(chargeResult[0].retailer_commission) || 0,
              distributor_commission: parseFloat(chargeResult[0].distributor_commission) || 0,
              md_commission: parseFloat(chargeResult[0].md_commission) || 0,
            }
            const txRef = `RKCC_COMM_${requestId}`
            if (commSplit.retailer_commission > 0) {
              await supabaseAdmin.rpc('add_ledger_entry', {
                p_user_id: tx.retailer_id,
                p_user_role: 'retailer',
                p_wallet_type: 'primary',
                p_fund_category: 'commission',
                p_service_type: 'rechargekit',
                p_tx_type: 'COMMISSION_CREDIT',
                p_credit: commSplit.retailer_commission,
                p_debit: 0,
                p_reference_id: txRef,
                p_transaction_id: tx.id,
                p_status: 'completed',
                p_remarks: `Commission on CC-2 ₹${tx.bill_amount} (callback)`,
              })
            }
            if (commSplit.distributor_commission > 0 && distributorId) {
              await supabaseAdmin.rpc('add_ledger_entry', {
                p_user_id: distributorId,
                p_user_role: 'distributor',
                p_wallet_type: 'primary',
                p_fund_category: 'commission',
                p_service_type: 'rechargekit',
                p_tx_type: 'COMMISSION_CREDIT',
                p_credit: commSplit.distributor_commission,
                p_debit: 0,
                p_reference_id: txRef,
                p_status: 'completed',
                p_remarks: `DT commission on CC-2 ₹${tx.bill_amount} (callback, RT:${tx.retailer_id})`,
              })
            }
            if (commSplit.md_commission > 0 && mdId) {
              await supabaseAdmin.rpc('add_ledger_entry', {
                p_user_id: mdId,
                p_user_role: 'master_distributor',
                p_wallet_type: 'primary',
                p_fund_category: 'commission',
                p_service_type: 'rechargekit',
                p_tx_type: 'COMMISSION_CREDIT',
                p_credit: commSplit.md_commission,
                p_debit: 0,
                p_reference_id: txRef,
                p_status: 'completed',
                p_remarks: `MD commission on CC-2 ₹${tx.bill_amount} (callback, RT:${tx.retailer_id})`,
              })
            }
          }
        }
      } catch (commErr: any) {
        console.error('[Rechargekit Callback] Commission error (non-fatal):', commErr.message)
      }

      console.log(`[Rechargekit Callback] SUCCESS: ${requestId}`)
      return NextResponse.json({ ok: true, status: 'success' })
    }

    if (providerStatus === 3) {
      // FAILED — refund the wallet
      await supabaseAdmin.from('bbps_transactions').update({
        status: 'failed',
        payment_status: 'failed',
        error_message: providerMsg || 'Payment failed (callback)',
        completed_at: new Date().toISOString(),
        additional_info: updatedInfo,
      }).eq('id', tx.id)

      // Refund: get original debit amount from ledger
      const { data: debitEntry } = await supabaseAdmin
        .from('wallet_ledger')
        .select('debit, user_role')
        .eq('reference_id', requestId)
        .eq('transaction_type', 'RECHARGEKIT_CC_DEBIT')
        .maybeSingle()

      if (debitEntry && debitEntry.debit > 0) {
        await supabaseAdmin.rpc('add_ledger_entry', {
          p_user_id: tx.retailer_id,
          p_user_role: debitEntry.user_role || 'retailer',
          p_wallet_type: 'primary',
          p_fund_category: 'service',
          p_service_type: 'rechargekit',
          p_tx_type: 'RECHARGEKIT_CC_REFUND',
          p_credit: debitEntry.debit,
          p_debit: 0,
          p_reference_id: `REFUND_${requestId}`,
          p_transaction_id: tx.id,
          p_status: 'completed',
          p_remarks: `Refund ₹${debitEntry.debit} | CC-2 callback failed: ${providerMsg}`,
        })
      }

      console.log(`[Rechargekit Callback] FAILED + REFUNDED: ${requestId}`)
      return NextResponse.json({ ok: true, status: 'failed', refunded: true })
    }

    // Status 2 or other = still pending
    await supabaseAdmin.from('bbps_transactions').update({
      additional_info: updatedInfo,
    }).eq('id', tx.id)

    console.log(`[Rechargekit Callback] Still pending: ${requestId} (status=${providerStatus})`)
    return NextResponse.json({ ok: true, status: 'pending' })
  } catch (error: any) {
    console.error('[Rechargekit Callback] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok', message: 'Rechargekit callback endpoint active' })
}
