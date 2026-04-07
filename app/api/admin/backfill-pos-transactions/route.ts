import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface BackfillTransaction {
  txnId: string
  tid: string
  mid: string
  amount: number
  status: string
  rrn: string
  authCode: string
  cardLastFour: string
  customerName: string
  paymentMode: string
  deviceSerial: string
  txnTime: string
  cardBrand?: string
  cardType?: string
  cardTxnType?: string
  paymentCardBrand?: string
  paymentCardType?: string
}

/**
 * POST /api/admin/backfill-pos-transactions
 *
 * Admin-only endpoint to backfill missing POS transactions that were not
 * captured by the webhook (e.g. webhook not configured for certain TIDs).
 *
 * Inserts into both razorpay_pos_transactions and pos_transactions tables,
 * and updates partner_pos_machines.last_txn_at.
 *
 * Body: { transactions: BackfillTransaction[] }
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized — admin only' }, { status: 403 })
    }

    const body = await request.json()
    const { transactions } = body as { transactions: BackfillTransaction[] }

    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
      return NextResponse.json(
        { error: 'transactions array is required and must not be empty' },
        { status: 400 }
      )
    }

    if (transactions.length > 100) {
      return NextResponse.json(
        { error: 'Maximum 100 transactions per request' },
        { status: 400 }
      )
    }

    const results: Array<{
      txnId: string
      tid: string
      action: string
      success: boolean
      error?: string
    }> = []

    for (const txn of transactions) {
      try {
        if (!txn.txnId || !txn.tid || !txn.amount || !txn.txnTime) {
          results.push({
            txnId: txn.txnId || 'unknown',
            tid: txn.tid || 'unknown',
            action: 'rejected',
            success: false,
            error: 'Missing required fields: txnId, tid, amount, txnTime',
          })
          continue
        }

        const txnTime = new Date(txn.txnTime)
        if (isNaN(txnTime.getTime())) {
          results.push({
            txnId: txn.txnId,
            tid: txn.tid,
            action: 'rejected',
            success: false,
            error: 'Invalid txnTime format',
          })
          continue
        }

        const amountRupees = typeof txn.amount === 'number' ? txn.amount : parseFloat(String(txn.amount))
        const amountPaisa = Math.round(amountRupees * 100)

        // Look up partner_pos_machines for this TID
        const { data: partnerMachine } = await supabase
          .from('partner_pos_machines')
          .select('partner_id, retailer_id, status, device_serial')
          .eq('terminal_id', txn.tid)
          .maybeSingle()

        if (!partnerMachine) {
          results.push({
            txnId: txn.txnId,
            tid: txn.tid,
            action: 'rejected',
            success: false,
            error: `No partner_pos_machines entry for TID ${txn.tid}`,
          })
          continue
        }

        const deviceSerial = txn.deviceSerial || partnerMachine.device_serial || null
        const mappedStatus = txn.status === 'AUTHORIZED' ? 'CAPTURED' : (txn.status || 'CAPTURED')
        const displayStatus = mappedStatus === 'CAPTURED' ? 'SUCCESS' : mappedStatus === 'FAILED' ? 'FAILED' : 'PENDING'

        // ---- Insert into razorpay_pos_transactions ----
        const { data: existingRpt } = await supabase
          .from('razorpay_pos_transactions')
          .select('id')
          .eq('txn_id', txn.txnId)
          .maybeSingle()

        if (!existingRpt) {
          const { error: rptError } = await supabase
            .from('razorpay_pos_transactions')
            .insert({
              txn_id: txn.txnId,
              status: txn.status || 'AUTHORIZED',
              display_status: displayStatus,
              amount: amountRupees,
              payment_mode: txn.paymentMode || 'CARD',
              device_serial: deviceSerial,
              tid: txn.tid,
              merchant_name: 'Same Day Solution',
              merchant_slug: 'samedaysolution',
              transaction_time: txnTime.toISOString(),
              customer_name: txn.customerName || null,
              payer_name: txn.customerName || null,
              txn_type: 'CHARGE',
              auth_code: txn.authCode || null,
              card_number: txn.cardLastFour ? `XXXX-XXXX-XXXX-${txn.cardLastFour}` : null,
              card_brand: txn.cardBrand || txn.paymentCardBrand || null,
              card_type: txn.cardType || txn.paymentCardType || null,
              card_classification: null,
              mid_code: txn.mid || null,
              currency: 'INR',
              rrn: txn.rrn || null,
              external_ref: null,
              settlement_status: 'PENDING',
              receipt_url: null,
              posting_date: txnTime.toISOString(),
              card_txn_type: txn.cardTxnType || null,
              acquiring_bank: null,
              raw_data: { _source: 'admin_backfill', ...txn },
            })

          if (rptError) {
            console.error(`Backfill: Error inserting razorpay_pos_transactions for ${txn.txnId}:`, rptError)
          }
        }

        // ---- Insert into pos_transactions ----
        const { data: existingPt } = await supabase
          .from('pos_transactions')
          .select('id')
          .eq('razorpay_txn_id', txn.txnId)
          .maybeSingle()

        if (existingPt) {
          results.push({
            txnId: txn.txnId,
            tid: txn.tid,
            action: 'duplicate',
            success: true,
          })
          continue
        }

        const { error: ptError } = await supabase
          .from('pos_transactions')
          .insert({
            partner_id: partnerMachine.partner_id,
            retailer_id: partnerMachine.retailer_id,
            terminal_id: txn.tid,
            razorpay_txn_id: txn.txnId,
            external_ref: null,
            amount: amountPaisa,
            status: mappedStatus,
            rrn: txn.rrn || null,
            card_brand: txn.cardBrand || txn.paymentCardBrand || null,
            card_type: txn.cardType || txn.paymentCardType || null,
            payment_mode: txn.paymentMode || 'CARD',
            settlement_status: 'PENDING',
            device_serial: deviceSerial,
            txn_time: txnTime.toISOString(),
            raw_payload: { _source: 'admin_backfill', ...txn },
            customer_name: txn.customerName || null,
            payer_name: txn.customerName || null,
            txn_type: 'CHARGE',
            auth_code: txn.authCode || null,
            card_number: txn.cardLastFour ? `XXXX-XXXX-XXXX-${txn.cardLastFour}` : null,
            issuing_bank: null,
            card_classification: null,
            mid: txn.mid || null,
            currency: 'INR',
            receipt_url: null,
            posting_date: txnTime.toISOString(),
            card_txn_type: txn.cardTxnType || null,
            acquiring_bank: null,
            merchant_name: 'Same Day Solution',
          })

        if (ptError) {
          console.error(`Backfill: Error inserting pos_transactions for ${txn.txnId}:`, ptError)
          results.push({
            txnId: txn.txnId,
            tid: txn.tid,
            action: 'error',
            success: false,
            error: ptError.message,
          })
          continue
        }

        // ---- Update last_txn_at on partner_pos_machines ----
        await supabase
          .from('partner_pos_machines')
          .update({ last_txn_at: txnTime.toISOString() })
          .eq('terminal_id', txn.tid)

        results.push({
          txnId: txn.txnId,
          tid: txn.tid,
          action: 'inserted',
          success: true,
        })
      } catch (txnError: any) {
        results.push({
          txnId: txn.txnId || 'unknown',
          tid: txn.tid || 'unknown',
          action: 'error',
          success: false,
          error: txnError.message,
        })
      }
    }

    const inserted = results.filter(r => r.action === 'inserted').length
    const duplicates = results.filter(r => r.action === 'duplicate').length
    const errors = results.filter(r => !r.success).length

    return NextResponse.json({
      success: true,
      summary: {
        total: transactions.length,
        inserted,
        duplicates,
        errors,
      },
      results,
    })
  } catch (error: any) {
    console.error('Error in backfill-pos-transactions:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
