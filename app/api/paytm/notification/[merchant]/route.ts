import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as crypto from 'crypto'

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

    const checksumHeader = request.headers.get('x-paytm-checksum') || request.headers.get('x-checksum')
    const paytmSecret = process.env.PAYTM_WEBHOOK_SECRET
    if (paytmSecret) {
      if (!checksumHeader) {
        console.error(`[Paytm/${merchantSlug}] Missing checksum header — rejecting`)
        return NextResponse.json({ error: 'Missing checksum' }, { status: 401 })
      }
      const expectedChecksum = crypto
        .createHmac('sha256', paytmSecret)
        .update(rawBody)
        .digest('hex')

      const sigBuf = Buffer.from(checksumHeader)
      const expBuf = Buffer.from(expectedChecksum)
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        console.error(`[Paytm/${merchantSlug}] Invalid checksum`)
        return NextResponse.json({ error: 'Invalid checksum' }, { status: 401 })
      }
      console.log(`[Paytm/${merchantSlug}] Checksum verified`)
    } else {
      // PRODUCTION: configure PAYTM_WEBHOOK_SECRET to enforce checksum verification
      console.warn(`[Paytm/${merchantSlug}] PAYTM_WEBHOOK_SECRET not configured — skipping verification (configure in production!)`)
    }

    // Extract transaction ID — Paytm uses various field names
    const txnId =
      payload.txnId ||
      payload.transactionId ||
      payload.orderId ||
      payload.TXNID ||
      payload.ORDER_ID ||
      payload.id
    if (!txnId) {
      console.error(`[Paytm/${merchantSlug}] Missing transaction ID`, payload)
      return NextResponse.json(
        { received: true, processed: false, error: 'Missing transaction ID' },
        { status: 200 }
      )
    }

    // Parse amount
    let amount = 0
    const rawAmount = payload.txnAmount || payload.TXNAMOUNT || payload.amount || payload.TXN_AMOUNT || 0
    if (typeof rawAmount === 'string') {
      amount = parseFloat(rawAmount)
    } else {
      amount = rawAmount
    }

    // Map Paytm status to unified status
    const paytmStatus = (payload.status || payload.STATUS || payload.resultStatus || '').toString().toUpperCase()
    let mappedStatus = 'PENDING'
    if (paytmStatus === 'TXN_SUCCESS' || paytmStatus === 'SUCCESS' || paytmStatus === 'CAPTURED') {
      mappedStatus = 'CAPTURED'
    } else if (paytmStatus === 'TXN_FAILURE' || paytmStatus === 'FAILED' || paytmStatus === 'DECLINED') {
      mappedStatus = 'FAILED'
    } else if (paytmStatus === 'PENDING' || paytmStatus === 'OPEN') {
      mappedStatus = 'PENDING'
    }

    const tid = payload.terminalId || payload.TERMINAL_ID || payload.posId || payload.tid || null
    const mid = payload.mid || payload.MID || payload.merchantId || null
    const deviceSerial = payload.deviceSerial || payload.terminalId || tid || null
    const rrn = payload.bankTxnId || payload.BANKTXNID || payload.rrn || payload.RRN || null
    const paymentMode = payload.paymentMode || payload.PAYMENTMODE || payload.payment_mode || 'CARD'
    const cardNumber = payload.maskedCardNumber || payload.cardNumber || payload.CARD_NUMBER || null
    const cardType = payload.cardType || payload.CARD_TYPE || null
    const cardBrand = payload.cardScheme || payload.cardBrand || payload.CARD_BRAND || null
    const bankName = payload.bankName || payload.BANKNAME || payload.gatewayName || null

    let createdTime = new Date()
    if (payload.txnDate || payload.TXNDATE || payload.transactionDate) {
      const dtStr = payload.txnDate || payload.TXNDATE || payload.transactionDate
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
      raw_data: { ...payload, _source: 'paytm', _brand: 'PAYTM' },
      customer_name: payload.customerName || payload.CUST_NAME || null,
      payer_name: payload.customerName || null,
      username: null,
      txn_type: payload.txnType || payload.TXNTYPE || 'CHARGE',
      auth_code: payload.authCode || payload.AUTH_CODE || null,
      card_number: cardNumber,
      issuing_bank: bankName,
      card_classification: null,
      mid_code: mid,
      card_brand: cardBrand,
      card_type: cardType,
      currency: payload.currency || payload.CURRENCY || 'INR',
      rrn: rrn,
      external_ref: payload.orderId || payload.ORDER_ID || null,
      settlement_status: mappedStatus === 'CAPTURED' ? 'PENDING' : null,
      receipt_url: payload.receiptUrl || null,
      posting_date: createdTime.toISOString(),
      card_txn_type: payload.entryMode || payload.cardEntryMode || null,
      acquiring_bank: payload.gatewayName || payload.GATEWAYNAME || null,
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
