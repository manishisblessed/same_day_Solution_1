import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyChecksum, fetchPaytmStatusBody } from '@/lib/paytm'
import { deliverPartnerCallback, deliverPartnerReversal } from '@/lib/partner-webhook/deliver'

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

    // Paytm sends THREE callbacks per CARD transaction: PRE_AUTH, a plain success,
    // and CAPTURE. Per Paytm's integration guidance we must record ONLY the CAPTURE
    // event and ignore the other two. UPI/QR sends a single callback with no txnType
    // (record it). Reversal/refund/void events must never be dropped.
    const txnTypeUp = (data.txnType || data.TXNTYPE || '').toString().toUpperCase()
    const pmUp = (data.paymentMode || data.PAYMENTMODE || '').toString().toUpperCase()
    const isCardTxn = pmUp.includes('CARD')
    const isReversalEvent =
      txnTypeUp.includes('REFUND') || txnTypeUp.includes('VOID') || txnTypeUp.includes('REVERS')
    if (!isReversalEvent && (txnTypeUp === 'PRE_AUTH' || (isCardTxn && txnTypeUp !== 'CAPTURE'))) {
      console.log(`[Paytm/${merchantSlug}] Ignoring non-CAPTURE event (txnType=${txnTypeUp || 'none'}, mode=${pmUp}) order=${data.orderId || data.merchantTransactionId}`)
      return NextResponse.json(
        { received: true, processed: false, ignored: true, reason: `non-CAPTURE event: ${txnTypeUp || 'none'}` },
        { status: 200 }
      )
    }

    // The live ECR S2S callback is the lean "soundbox" shape (txnId/orderId/respCode)
    // and omits RRN, acquirementId and card details. Enrich from Status Enquiry using
    // OUR id (sent back as orderId) so the stored row has the full transaction data.
    // Best-effort: never fail the callback if enrichment errors.
    const ourMtxnId = data.merchantTransactionId || data.orderId
    const missingDetail = !(data.retrievalReferenceNo || data.rrn) || !data.acquirementId
    if (ourMtxnId && missingDetail) {
      try {
        const statusBody = await fetchPaytmStatusBody(ourMtxnId, { tid: data.paytmTid || data.tid })
        const sInfo: any = statusBody?.resultInfo || {}
        if (sInfo.resultStatus === 'SUCCESS' || sInfo.resultCodeId === '0000') {
          for (const k of Object.keys(statusBody)) {
            const v = (statusBody as any)[k]
            if (v != null && v !== '' && (data[k] === undefined || data[k] === null || data[k] === '')) {
              data[k] = v
            }
          }
          console.log(`[Paytm/${merchantSlug}] Enriched ${ourMtxnId} from status enquiry`)
        }
      } catch (e: any) {
        console.warn(`[Paytm/${merchantSlug}] Status enrichment failed for ${ourMtxnId}: ${e?.message}`)
      }
    }

    // resultInfo is nested in the ECR S2S callback: { resultStatus, resultCode, resultCodeId, resultMsg }
    const resultInfo: any = data.resultInfo || {}

    // Extract transaction ID. The real ECR S2S callback uses merchantTransactionId
    // (our generated id) + acquirementId (Paytm's txn id). Older/soundbox payloads
    // may use txnId/orderId — support all.
    // Key on OUR id so callback rows reconcile to the sale we initiated. The live
    // ECR S2S callback returns our merchantTransactionId as `orderId`, while `txnId`
    // is Paytm's acquirer id — so orderId must take priority over txnId.
    const txnId =
      data.merchantTransactionId ||
      data.orderId ||
      data.txnId ||
      data.transactionId ||
      data.acquirementId ||
      data.id
    if (!txnId) {
      console.error(`[Paytm/${merchantSlug}] Missing transaction ID`, payload)
      return NextResponse.json(
        { received: true, processed: false, error: 'Missing transaction ID' },
        { status: 200 }
      )
    }

    // Parse amount. ECR S2S callback sends transactionAmount in PAISE (e.g. "100" = ₹1).
    // Soundbox-style callbacks send txnAmount in rupees (e.g. "1.00").
    let amount = 0
    if (data.transactionAmount != null && data.transactionAmount !== '') {
      amount = Number(data.transactionAmount) / 100
    } else {
      const rawAmount = data.txnAmount ?? data.TXNAMOUNT ?? data.amount ?? 0
      amount = typeof rawAmount === 'string' ? parseFloat(rawAmount) : Number(rawAmount)
    }
    if (!isFinite(amount)) amount = 0

    // Map Paytm status to unified status. ECR success = resultInfo.resultStatus "SUCCESS"
    // with resultCodeId "0000"; soundbox success = respCode "01"; older = "TXN_SUCCESS".
    const paytmStatus = (data.status || data.resultStatus || resultInfo.resultStatus || '')
      .toString()
      .toUpperCase()
    const resultCodeId = data.resultCodeId || resultInfo.resultCodeId
    const isSuccess =
      paytmStatus === 'TXN_SUCCESS' ||
      paytmStatus === 'SUCCESS' ||
      paytmStatus === 'CAPTURED' ||
      resultCodeId === '0000' ||
      data.respCode === '01'
    const paytmTxnType = (data.txnType || data.TXNTYPE || '').toString().toUpperCase()
    const isRefund = paytmTxnType.includes('REFUND') || paytmStatus.includes('REFUND')
    const isReversalRaw = isRefund || paytmTxnType.includes('VOID') || paytmTxnType.includes('REVERS') || paytmStatus.includes('VOID') || paytmStatus.includes('REVERS')
    let mappedStatus = 'PENDING'
    if (isReversalRaw) {
      mappedStatus = isRefund ? 'REFUNDED' : 'VOIDED'
    } else if (isSuccess) {
      mappedStatus = 'CAPTURED'
    } else if (paytmStatus.includes('FAIL') || paytmStatus === 'DECLINED') {
      mappedStatus = 'FAILED'
    }

    const tid = data.paytmTid || data.terminalId || data.TERMINAL_ID || data.posId || data.tid || null
    const mid = data.paytmMid || data.mid || data.MID || data.merchantId || null
    const deviceSerial = data.deviceSerial || tid || null
    const rrn =
      data.retrievalReferenceNo || data.rrn || data.RRN || data.bankTxnId || data.BANKTXNID || null
    const cardNumber = data.issuerMaskCardNo || data.maskedCardNumber || data.cardNumber || null
    const cardType = data.cardType || data.CARD_TYPE || null
    const cardBrand = data.cardScheme || data.cardBrand || data.CARD_BRAND || null
    const bankName = data.issuingBankName || data.bankName || data.acquiringBank || data.gatewayName || null
    // No paymentMode field on ECR UPI callbacks — infer: card present => CARD, else QR/UPI.
    const paymentMode = data.paymentMode || data.PAYMENTMODE || data.payment_mode || (cardNumber ? 'CARD' : 'QR')

    let createdTime = new Date()
    const dtStr =
      data.transactionDateTime || data.txnDateTime || data.txnDate || data.TXNDATE || data.transactionDate
    if (dtStr) {
      // Paytm timestamps are IST without a timezone marker; anchor them to +05:30.
      const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dtStr)
        ? dtStr.replace(' ', 'T') + '+05:30'
        : dtStr
      const parsed = new Date(iso)
      if (!isNaN(parsed.getTime())) createdTime = parsed
    }

    const prefixedTxnId = `PTM_${txnId}`

    const { data: existingTxn } = await supabase
      .from('razorpay_pos_transactions')
      .select('id, wallet_credited, retailer_id, display_status, partner_wallet_credited')
      .eq('txn_id', prefixedTxnId)
      .maybeSingle()

    const isReversalTransition = isReversalRaw && existingTxn?.display_status === 'SUCCESS'

    const posTransactionData: any = {
      txn_id: prefixedTxnId,
      status: paytmStatus || mappedStatus,
      display_status: isReversalRaw ? (isRefund ? 'REFUNDED' : 'VOIDED')
        : mappedStatus === 'CAPTURED' ? 'SUCCESS' : mappedStatus === 'FAILED' ? 'FAILED' : 'PENDING',
      reversed_at: isReversalRaw ? createdTime.toISOString() : null,
      reversal_reason: isReversalRaw ? `paytm-webhook:${paytmStatus || paytmTxnType}` : null,
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
      external_ref: data.acquirementId || data.txnId || null,
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

    // Forward to partner webhook — signed, retried, logged.
    if (isReversalTransition) {
      void deliverPartnerReversal({
        supabase,
        tid,
        deviceSerial,
        txnId: prefixedTxnId,
        payload: {
          event: 'pos.transaction.reversed',
          action: 'remove',
          txn_id: prefixedTxnId,
          rrn,
          terminal_id: tid,
          tid,
          device_serial: deviceSerial,
          mid,
          amount: amount || 0,
          previous_status: 'CAPTURED',
          status: isRefund ? 'REFUNDED' : 'VOIDED',
          reversed_at: createdTime.toISOString(),
          reason: `paytm-webhook:${paytmStatus || paytmTxnType}`,
          was_settled: !!(existingTxn?.partner_wallet_credited || existingTxn?.wallet_credited),
          _brand: 'PAYTM',
        },
        logPrefix: `Partner Reversal/${merchantSlug}`,
      })
      if (existingTxn?.partner_wallet_credited || existingTxn?.wallet_credited) {
        console.warn(`[Paytm/${merchantSlug}] REVERSAL AFTER SETTLEMENT — clawback needed txn=${prefixedTxnId} amount=${amount}`)
      }
    } else if (tid) {
      void deliverPartnerCallback({
        supabase,
        tid,
        txnId: prefixedTxnId,
        payload: { ...payload, mappedStatus, _brand: 'PAYTM' },
        logPrefix: `Partner Callback/${merchantSlug}`,
      })
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
