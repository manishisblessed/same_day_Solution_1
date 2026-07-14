import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_MERCHANTS: Record<string, string> = {
  avika: 'Avika Departmental Private Limited',
  ashvam: 'ASHVAM LEARNING PRIVATE LIMITED',
  teachway: 'Teachway Education Private Limited',
  newscenaric: 'New Scenaric Travels',
  lagoon: 'LAGOON CRAFT LABS SOLUTIONS PRIVATE LIMITED',
}

/**
 * Pine Labs POS Notification Endpoint
 *
 * Receives transaction callbacks from Pine Labs POS terminals.
 * Normalizes the payload and stores in razorpay_pos_transactions (unified table).
 *
 * Pine Labs typical payload fields:
 * - TransactionNumber, Amount, ApprovalCode, CardNumber, CardType,
 *   HostResponse, RRN, BatchNumber, TerminalId, MerchantId, etc.
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

  console.log(`[PineLab/${merchantSlug}] Received notification for ${merchantName}`)

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

    // Optional signature verification for Pine Labs
    const signature = request.headers.get('x-pinelab-signature') || request.headers.get('x-signature')
    const pinelabSecret = process.env.PINELAB_WEBHOOK_SECRET
    if (signature && pinelabSecret) {
      const expectedSignature = crypto
        .createHmac('sha256', pinelabSecret)
        .update(rawBody)
        .digest('hex')

      const sigBuf = Buffer.from(signature)
      const expBuf = Buffer.from(expectedSignature)
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        console.error(`[PineLab/${merchantSlug}] Invalid signature`)
        return NextResponse.json(
          { received: true, processed: false, error: 'Invalid signature' },
          { status: 200 }
        )
      }
      console.log(`[PineLab/${merchantSlug}] Signature verified`)
    }

    // Normalize Pine Labs payload to unified format
    // Pine Labs sends different field naming conventions depending on integration
    const txnId =
      payload.TransactionNumber ||
      payload.PlutusTransactionReferenceID ||
      payload.TransactionId ||
      payload.txnId ||
      payload.id
    if (!txnId) {
      console.error(`[PineLab/${merchantSlug}] Missing transaction ID`, payload)
      return NextResponse.json(
        { received: true, processed: false, error: 'Missing transaction ID' },
        { status: 200 }
      )
    }

    // Parse amount (Pine Labs usually sends in paise or as string with decimals)
    let amount = 0
    const rawAmount = payload.Amount || payload.TransactionAmount || payload.amount || 0
    if (typeof rawAmount === 'string') {
      amount = parseFloat(rawAmount)
    } else {
      amount = rawAmount
    }
    // Pine Labs often sends amount in paise
    if (amount > 100000) {
      amount = amount / 100
    }

    // Map Pine Labs status to unified status
    const hostResponse = (payload.HostResponse || payload.ResponseCode || payload.status || '').toString()
    let mappedStatus = 'PENDING'
    if (hostResponse === '00' || hostResponse === 'APPROVED' || payload.TransactionStatus === 'Approved') {
      mappedStatus = 'CAPTURED'
    } else if (hostResponse === 'DECLINED' || hostResponse === '05' || hostResponse === '51' || payload.TransactionStatus === 'Declined') {
      mappedStatus = 'FAILED'
    } else if (payload.TransactionStatus === 'Void' || payload.TransactionType === 'VOID') {
      mappedStatus = 'FAILED'
    }

    const deviceSerial = payload.TerminalId || payload.terminalId || payload.DeviceSerial || null
    const tid = payload.TerminalId || payload.TID || payload.terminalId || null
    const mid = payload.MerchantId || payload.MID || payload.merchantId || null
    const rrn = payload.RRN || payload.RetrievalReferenceNumber || payload.rrn || null
    const authCode = payload.ApprovalCode || payload.AuthCode || payload.authCode || null
    const cardNumber = payload.CardNumber || payload.MaskedCardNumber || payload.cardNumber || null
    const cardType = payload.CardType || payload.cardType || null
    const cardBrand = payload.CardScheme || payload.CardBrand || payload.cardBrand || null
    const paymentMode = payload.PaymentMode || payload.TransactionType || 'CARD'
    const batchNumber = payload.BatchNumber || payload.batchNumber || null
    const invoiceNumber = payload.InvoiceNumber || payload.invoiceNumber || null

    let createdTime = new Date()
    if (payload.TransactionDate || payload.TransactionDateTime) {
      const dtStr = payload.TransactionDate || payload.TransactionDateTime
      const parsed = new Date(dtStr)
      if (!isNaN(parsed.getTime())) createdTime = parsed
    }

    const { data: existingTxn } = await supabase
      .from('razorpay_pos_transactions')
      .select('id, wallet_credited, retailer_id')
      .eq('txn_id', `PL_${txnId}`)
      .maybeSingle()

    const posTransactionData: any = {
      txn_id: `PL_${txnId}`,
      status: hostResponse === '00' ? 'AUTHORIZED' : hostResponse,
      display_status: mappedStatus === 'CAPTURED' ? 'SUCCESS' : mappedStatus === 'FAILED' ? 'FAILED' : 'PENDING',
      amount: amount || 0,
      payment_mode: paymentMode.toUpperCase(),
      device_serial: deviceSerial,
      tid: tid,
      merchant_name: merchantName,
      merchant_slug: merchantSlug,
      transaction_time: createdTime.toISOString(),
      raw_data: { ...payload, _source: 'pinelab', _brand: 'PINELAB' },
      customer_name: payload.CustomerName || payload.customerName || null,
      payer_name: payload.CustomerName || null,
      username: null,
      txn_type: payload.TransactionType || 'CHARGE',
      auth_code: authCode,
      card_number: cardNumber,
      issuing_bank: payload.IssuingBank || payload.issuingBank || null,
      card_classification: payload.CardClassification || null,
      mid_code: mid,
      card_brand: cardBrand,
      card_type: cardType,
      currency: payload.Currency || 'INR',
      rrn: rrn,
      external_ref: invoiceNumber || batchNumber || null,
      settlement_status: mappedStatus === 'CAPTURED' ? 'PENDING' : null,
      receipt_url: payload.ReceiptUrl || payload.receiptUrl || null,
      posting_date: createdTime.toISOString(),
      card_txn_type: payload.EntryMode || payload.CardEntryMode || null,
      acquiring_bank: payload.AcquiringBank || payload.acquiringBank || null,
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
        .eq('txn_id', `PL_${txnId}`)
        .select()
        .single()

      if (error) console.error(`[PineLab/${merchantSlug}] Error updating:`, error)
      posResult = data || existingTxn
    } else {
      isNewTransaction = true
      const { data, error } = await supabase
        .from('razorpay_pos_transactions')
        .insert(posTransactionData)
        .select()
        .single()

      if (error) {
        console.error(`[PineLab/${merchantSlug}] Error inserting:`, error)
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
          .eq('txn_id', `PL_${txnId}`)

        console.log(`[PineLab/${merchantSlug}] Mapped retailer ${deviceMapping.retailer_id} for txn ${txnId}`)
      }

      // Attach owning partner + instant settle if partner mode is INSTANT
      if (posResult?.id) {
        try {
          const { attachPartnerAndMaybeInstantSettle } = await import('@/lib/partner-settlement')
          await attachPartnerAndMaybeInstantSettle(
            {
              id: posResult.id,
              txn_id: `PL_${txnId}`,
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
          console.error(`[PineLab/${merchantSlug}] Partner settlement error for txn ${txnId}:`, partnerErr)
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
              body: JSON.stringify({ ...payload, mappedStatus, _brand: 'PINELAB' }),
              signal: AbortSignal.timeout(10000),
            }).catch(err => console.error(`[PineLab/${merchantSlug}] Partner callback failed:`, err.message))
          }
        }
      } catch (err) {
        console.error(`[PineLab/${merchantSlug}] Partner lookup error:`, err)
      }
    }

    return NextResponse.json({
      received: true,
      processed: true,
      brand: 'PINELAB',
      merchant: merchantSlug,
      merchantName,
      transactionId: posResult?.id,
      txnId: `PL_${txnId}`,
      action: isNewTransaction ? 'created' : 'updated',
      status: mappedStatus,
    })
  } catch (error: any) {
    console.error(`[PineLab/${merchantSlug}] Error:`, error)
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
    message: `Pine Labs POS notification endpoint for ${merchantName}`,
    brand: 'PINELAB',
    merchant: merchantSlug,
    merchantName,
    status: 'active',
  })
}
