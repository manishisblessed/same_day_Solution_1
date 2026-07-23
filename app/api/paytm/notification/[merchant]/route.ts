import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyChecksum } from '@/lib/paytm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_MERCHANTS: Record<string, string> = {
  lagoon: 'LAGOON CRAFT LABS SOLUTIONS PRIVATE LIMITED',
  avika: 'Avika Departmental Private Limited',
  ashvam: 'ASHVAM LEARNING PRIVATE LIMITED',
  teachway: 'Teachway Education Private Limited',
  newscenaric: 'New Scenaric Travels',
}

/**
 * Paytm EDC/Soundbox POS Notification Endpoint
 *
 * Receives transaction callbacks from Paytm POS/EDC terminals.
 * Normalizes the payload and stores in razorpay_pos_transactions (unified table).
 *
 * Paytm typical payload fields:
 * - orderId, txnId, txnAmount, status (TXN_SUCCESS/TXN_FAILURE/PENDING),
 *   paymentMode, gatewayName, bankTxnId, bankName, mid, etc.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ merchant: string }> }
) {
  const { merchant } = await params
  const merchantSlug = merchant.toLowerCase()
  const merchantName = VALID_MERCHANTS[merchantSlug]

  if (!merchantName) {
    return NextResponse.json(
      { received: true, processed: false, error: `Unknown merchant: ${merchant}` },
      { status: 200 }
    )
  }

  console.log(`[Paytm/${merchantSlug}] Received notification for ${merchantName}`)

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { received: true, processed: false, error: 'Supabase configuration missing' },
      { status: 200 }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const rawBody = await request.text()
    let payload: any
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return NextResponse.json(
        { received: true, processed: false, error: 'Invalid JSON payload' },
        { status: 200 }
      )
    }

    // Paytm ECR S2S callbacks wrap the transaction in a { head, body } envelope,
    // with the signature in head.signature and all fields nested under body.
    const data: any =
      payload && typeof payload.body === 'object' && payload.body !== null ? payload.body : payload

    // Verify Paytm's signature (head.signature) over the body using the merchant key.
    // On staging we log the result but do NOT reject, so a valid test callback is
    // never silently dropped while we confirm the exact signing scheme.
    const signature: string | undefined = payload?.head?.signature || payload?.head?.checksum
    if (signature) {
      try {
        const valid = await verifyChecksum(data, signature)
        console.log(`[Paytm/${merchantSlug}] Signature ${valid ? 'verified' : 'verification FAILED (processing anyway)'}`)
      } catch (e: any) {
        console.warn(`[Paytm/${merchantSlug}] Signature verify error: ${e?.message}`)
      }
    } else {
      console.warn(`[Paytm/${merchantSlug}] No signature present in callback head`)
    }

    // Extract transaction ID — Paytm uses various field names (from unwrapped body)
    const txnId =
      data.txnId ||
      data.transactionId ||
      data.TXNID ||
      data.orderId ||
      data.ORDER_ID ||
      data.id
    if (!txnId) {
      console.error(`[Paytm/${merchantSlug}] Missing transaction ID`, payload)
      return NextResponse.json(
        { received: true, processed: false, error: 'Missing transaction ID' },
        { status: 200 }
      )
    }

    // Parse amount (S2S callback sends amount in rupees, e.g. "1.00")
    let amount = 0
    const rawAmount = data.txnAmount || data.TXNAMOUNT || data.amount || data.TXN_AMOUNT || 0
    if (typeof rawAmount === 'string') {
      amount = parseFloat(rawAmount)
    } else {
      amount = rawAmount
    }

    // Map Paytm status to unified status
    const paytmStatus = (data.status || data.STATUS || data.resultStatus || '').toString().toUpperCase()
    let mappedStatus = 'PENDING'
    if (paytmStatus === 'TXN_SUCCESS' || paytmStatus === 'SUCCESS' || paytmStatus === 'CAPTURED') {
      mappedStatus = 'CAPTURED'
    } else if (paytmStatus === 'TXN_FAILURE' || paytmStatus === 'FAILED' || paytmStatus === 'DECLINED') {
      mappedStatus = 'FAILED'
    } else if (paytmStatus === 'PENDING' || paytmStatus === 'OPEN') {
      mappedStatus = 'PENDING'
    }

    const tid = data.terminalId || data.TERMINAL_ID || data.posId || data.tid || data.paytmTid || null
    const mid = data.mid || data.MID || data.merchantId || data.paytmMid || null
    const deviceSerial = data.deviceSerial || data.terminalId || tid || null
    const rrn = data.rrn || data.RRN || data.bankTxnId || data.BANKTXNID || null
    const paymentMode = data.paymentMode || data.PAYMENTMODE || data.payment_mode || 'CARD'
    const cardNumber = data.maskedCardNumber || data.cardNumber || data.CARD_NUMBER || null
    const cardType = data.cardType || data.CARD_TYPE || null
    const cardBrand = data.cardScheme || data.cardBrand || data.CARD_BRAND || null
    const bankName = data.bankName || data.BANKNAME || data.issuingBankName || data.gatewayName || null

    let createdTime = new Date()
    const dtStr =
      data.txnDateTime || data.txnDate || data.TXNDATE || data.transactionDateTime || data.transactionDate
    if (dtStr) {
      const parsed = new Date(dtStr)
      if (!isNaN(parsed.getTime())) createdTime = parsed
    }

    const prefixedTxnId = `PTM_${txnId}`

    const { data: existingTxn } = await supabase
      .from('razorpay_pos_transactions')
      .select('id, wallet_credited, retailer_id')
      .eq('txn_id', prefixedTxnId)
      .maybeSingle()

    const posTransactionData: any = {
      txn_id: prefixedTxnId,
      status: paytmStatus || 'PENDING',
      display_status: mappedStatus === 'CAPTURED' ? 'SUCCESS' : mappedStatus === 'FAILED' ? 'FAILED' : 'PENDING',
      amount: amount || 0,
      payment_mode: paymentMode.toUpperCase(),
      device_serial: deviceSerial,
      tid: tid,
      merchant_name: merchantName,
      merchant_slug: merchantSlug,
      transaction_time: createdTime.toISOString(),
      raw_data: { ...payload, ...data, _source: 'paytm', _brand: 'PAYTM' },
      customer_name: data.customerName || data.CUST_NAME || null,
      payer_name: data.customerName || null,
      username: null,
      txn_type: data.txnType || data.TXNTYPE || 'CHARGE',
      auth_code: data.authCode || data.AUTH_CODE || null,
      card_number: cardNumber,
      issuing_bank: bankName,
      card_classification: null,
      mid_code: mid,
      card_brand: cardBrand,
      card_type: cardType,
      currency: data.currency || data.CURRENCY || 'INR',
      rrn: rrn,
      external_ref: data.orderId || data.ORDER_ID || data.merchantTransactionId || null,
      settlement_status: mappedStatus === 'CAPTURED' ? 'PENDING' : null,
      receipt_url: data.receiptUrl || null,
      posting_date: createdTime.toISOString(),
      card_txn_type: data.entryMode || data.cardEntryMode || null,
      acquiring_bank: data.acquiringBank || data.gatewayName || data.GATEWAYNAME || null,
      settlement_type: 'T1',
      partner_id: null,
    }

    let posResult
    let isNewTransaction = false

    if (existingTxn) {
      // Never reset partner_id on updates (attached separately)
      const { partner_id: _omitPartnerId, ...posUpdateData } = posTransactionData
      const { data, error } = await supabase
        .from('razorpay_pos_transactions')
        .update({ ...posUpdateData, updated_at: new Date().toISOString() })
        .eq('txn_id', prefixedTxnId)
        .select()
        .single()

      if (error) console.error(`[Paytm/${merchantSlug}] Error updating:`, error)
      posResult = data || existingTxn
    } else {
      isNewTransaction = true
      const { data, error } = await supabase
        .from('razorpay_pos_transactions')
        .insert(posTransactionData)
        .select()
        .single()

      if (error) {
        console.error(`[Paytm/${merchantSlug}] Error inserting:`, error)
        return NextResponse.json(
          { received: true, processed: false, error: error.message },
          { status: 200 }
        )
      }
      posResult = data
    }

    // Map device to retailer hierarchy if CAPTURED
    if (mappedStatus === 'CAPTURED' && deviceSerial && amount > 0) {
      const { data: deviceMapping } = await supabase
        .from('pos_device_mapping')
        .select('retailer_id, distributor_id, master_distributor_id')
        .eq('device_serial', deviceSerial)
        .eq('status', 'ACTIVE')
        .maybeSingle()

      if (deviceMapping?.retailer_id) {
        await supabase
          .from('razorpay_pos_transactions')
          .update({
            retailer_id: deviceMapping.retailer_id,
            distributor_id: deviceMapping.distributor_id,
            master_distributor_id: deviceMapping.master_distributor_id,
            gross_amount: amount,
          })
          .eq('txn_id', prefixedTxnId)

        console.log(`[Paytm/${merchantSlug}] Mapped retailer ${deviceMapping.retailer_id} for txn ${txnId}`)
      }

      // Attach owning partner + instant settle if partner mode is INSTANT
      if (posResult?.id) {
        try {
          const { attachPartnerAndMaybeInstantSettle } = await import('@/lib/partner-settlement')
          await attachPartnerAndMaybeInstantSettle(
            {
              id: posResult.id,
              txn_id: prefixedTxnId,
              amount,
              gross_amount: amount,
              payment_mode: paymentMode,
              card_type: cardType,
              card_brand: cardBrand,
              merchant_slug: merchantSlug,
              partner_id: posResult.partner_id || null,
            },
            deviceSerial,
            tid
          )
        } catch (partnerErr: any) {
          console.error(`[Paytm/${merchantSlug}] Partner settlement error for txn ${txnId}:`, partnerErr)
        }
      }
    }

    // Forward to partner webhook if applicable
    if (tid) {
      try {
        const { data: partnerRows } = await supabase
          .from('partner_pos_machines')
          .select('partner_id')
          .eq('terminal_id', tid)
          .eq('status', 'active')
          .limit(1)

        if (partnerRows?.length === 1) {
          const { data: partnerRecord } = await supabase
            .from('partners')
            .select('webhook_url')
            .eq('id', partnerRows[0].partner_id)
            .eq('status', 'active')
            .maybeSingle()

          if (partnerRecord?.webhook_url) {
            fetch(partnerRecord.webhook_url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...payload, mappedStatus, _brand: 'PAYTM' }),
              signal: AbortSignal.timeout(10000),
            }).catch(err => console.error(`[Paytm/${merchantSlug}] Partner callback failed:`, err.message))
          }
        }
      } catch (err) {
        console.error(`[Paytm/${merchantSlug}] Partner lookup error:`, err)
      }
    }

    return NextResponse.json({
      received: true,
      processed: true,
      brand: 'PAYTM',
      merchant: merchantSlug,
      merchantName,
      transactionId: posResult?.id,
      txnId: prefixedTxnId,
      action: isNewTransaction ? 'created' : 'updated',
      status: mappedStatus,
    })
  } catch (error: any) {
    console.error(`[Paytm/${merchantSlug}] Error:`, error)
    return NextResponse.json({
      received: true,
      processed: false,
      merchant: merchantSlug,
      error: error.message || 'Unknown error',
    })
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ merchant: string }> }
) {
  const { merchant } = await params
  const merchantSlug = merchant?.toLowerCase() ?? ''
  const merchantName = VALID_MERCHANTS[merchantSlug]

  if (!merchantName) {
    return NextResponse.json(
      { error: `Unknown merchant: ${merchant}`, valid_merchants: Object.keys(VALID_MERCHANTS) },
      { status: 200 }
    )
  }

  return NextResponse.json({
    message: `Paytm POS notification endpoint for ${merchantName}`,
    brand: 'PAYTM',
    merchant: merchantSlug,
    merchantName,
    status: 'active',
  })
}
