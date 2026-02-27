import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { mapTransactionStatus } from '@/lib/razorpay/service'
import * as crypto from 'crypto'

const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_MERCHANTS: Record<string, string> = {
  teachway: 'Teachway Education Private Limited',
  newscenaric: 'New Scenaric Travels',
  lagoon: 'LAGOON CRAFT LABS SOLUTIONS PRIVATE LIMITED',
}

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

  console.log(`[Webhook/${merchantSlug}] Received notification for ${merchantName}`)

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
    const signature = request.headers.get('x-razorpay-signature')

    let payload: any

    if (signature && RAZORPAY_WEBHOOK_SECRET) {
      const rawBody = await request.text()
      payload = JSON.parse(rawBody)

      const expectedSignature = crypto
        .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex')

      if (!crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      )) {
        console.error(`[Webhook/${merchantSlug}] Invalid signature`)
        return NextResponse.json(
          { received: true, processed: false, error: 'Invalid signature' },
          { status: 200 }
        )
      }
    } else {
      payload = await request.json()
    }

    const isStandardWebhook = !!(payload.event && payload.payload)
    let normalizedPayload: any

    if (isStandardWebhook) {
      console.log(`[Webhook/${merchantSlug}] Standard Razorpay format, event:`, payload.event)

      const eventType = payload.event
      const paymentEntity = payload.payload?.payment?.entity

      if (!paymentEntity) {
        return NextResponse.json(
          { received: true, processed: false, error: 'Missing payment entity' },
          { status: 200 }
        )
      }

      let rzpStatus = 'PENDING'
      if (eventType === 'payment.captured' || paymentEntity.status === 'captured') {
        rzpStatus = 'AUTHORIZED'
      } else if (eventType === 'payment.authorized' || paymentEntity.status === 'authorized') {
        rzpStatus = 'AUTHORIZED'
      } else if (eventType === 'payment.failed' || paymentEntity.status === 'failed') {
        rzpStatus = 'FAILED'
      } else if (paymentEntity.status === 'refunded') {
        rzpStatus = 'REFUNDED'
      }

      normalizedPayload = {
        txnId: paymentEntity.id,
        amount: paymentEntity.amount ? paymentEntity.amount / 100 : 0,
        currencyCode: paymentEntity.currency?.toUpperCase() || 'INR',
        status: rzpStatus,
        paymentMode: (paymentEntity.method || '').toUpperCase(),
        settlementStatus: paymentEntity.status === 'captured' ? 'SETTLED' : 'PENDING',
        customerName: paymentEntity.notes?.customer_name || paymentEntity.email || '',
        payerName: paymentEntity.notes?.customer_name || paymentEntity.contact || '',
        merchantName: paymentEntity.notes?.merchant_name || merchantName,
        rrNumber: paymentEntity.acquirer_data?.rrn || '',
        tid: paymentEntity.terminal_id || '',
        mid: paymentEntity.notes?.mid || '',
        deviceSerial: '',
        txnType: 'PAYMENT_LINK',
        postingDate: paymentEntity.created_at ? new Date(paymentEntity.created_at * 1000).toISOString() : new Date().toISOString(),
        createdTime: paymentEntity.created_at ? paymentEntity.created_at * 1000 : Date.now(),
        _source: 'standard_webhook',
        _event: eventType,
        _payment_id: paymentEntity.id,
        _order_id: paymentEntity.order_id || '',
        _original_payload: payload,
      }
    } else {
      console.log(`[Webhook/${merchantSlug}] POS notification format, txnId:`, payload.txnId || payload.id)
      normalizedPayload = { ...payload, _source: 'pos_notification' }
      if (!normalizedPayload.merchantName) {
        normalizedPayload.merchantName = merchantName
      }
    }

    const txnId = normalizedPayload.txnId || normalizedPayload.id
    if (!txnId) {
      return NextResponse.json(
        { received: true, processed: false, error: 'Missing txnId field' },
        { status: 200 }
      )
    }

    const mappedStatus = mapTransactionStatus(normalizedPayload)

    const amount = normalizedPayload.amount ? parseFloat(normalizedPayload.amount) : null
    const paymentMode = normalizedPayload.paymentMode || null
    const rrNumber = normalizedPayload.rrNumber || normalizedPayload.rrn || null
    const deviceSerial = normalizedPayload.deviceSerial || normalizedPayload.device_serial || normalizedPayload.terminalId || null
    const tid = normalizedPayload.tid || normalizedPayload.terminalId || null

    let createdTime: Date | null = null
    if (normalizedPayload.createdTime) {
      createdTime = new Date(
        typeof normalizedPayload.createdTime === 'number'
          ? normalizedPayload.createdTime
          : normalizedPayload.createdTime
      )
    } else if (normalizedPayload.created_at) {
      createdTime = new Date(normalizedPayload.created_at)
    }
    if (!createdTime || isNaN(createdTime.getTime())) {
      createdTime = new Date()
    }

    const rawDataToStore = isStandardWebhook
      ? { ...normalizedPayload, _original_webhook: normalizedPayload._original_payload }
      : payload

    const { data: existingPosTransaction } = await supabase
      .from('razorpay_pos_transactions')
      .select('id, wallet_credited, retailer_id')
      .eq('txn_id', txnId)
      .maybeSingle()

    const customerName = normalizedPayload.customerName || normalizedPayload.payerName || null
    const payerName = normalizedPayload.payerName || null
    const username = normalizedPayload.username || null
    const txnType = normalizedPayload.txnType || 'CHARGE'
    const authCode = normalizedPayload.authCode || null
    const cardNumber = normalizedPayload.formattedPan || normalizedPayload.cardNumber || normalizedPayload.maskedCardNumber || null
    const issuingBank = normalizedPayload.issuingBankName || normalizedPayload.bankName || normalizedPayload.issuingBank || null
    const cardClassification = normalizedPayload.cardClassification || normalizedPayload.cardCategory || null
    const midCode = normalizedPayload.mid || normalizedPayload.merchantId || null
    const cardBrand = normalizedPayload.paymentCardBrand || normalizedPayload.cardBrand || null
    const cardType = normalizedPayload.paymentCardType || normalizedPayload.cardType || null
    const currencyCode = normalizedPayload.currencyCode || normalizedPayload.currency || 'INR'
    const customerReceiptUrl = normalizedPayload.customerReceiptUrl || normalizedPayload.receiptUrl || null
    const cardTxnType = normalizedPayload.cardTxnType || normalizedPayload.cardTransactionType || normalizedPayload.entryMode || null
    const acquiringBank = normalizedPayload.acquiringBank || normalizedPayload.acquiringBankName || normalizedPayload.acquirerCode || null
    const postingDateStr = normalizedPayload.postingDate || null
    const settlementStatusVal = normalizedPayload.settlementStatus || null
    const externalRef = normalizedPayload.externalRefNumber || normalizedPayload.external_ref || null

    let postingDateParsed: Date | null = null
    if (postingDateStr) {
      try { postingDateParsed = new Date(postingDateStr) } catch { /* ignore */ }
    }

    const posTransactionData: any = {
      txn_id: txnId,
      status: normalizedPayload.status || 'PENDING',
      display_status: mappedStatus === 'CAPTURED' ? 'SUCCESS' : mappedStatus === 'FAILED' ? 'FAILED' : 'PENDING',
      amount: amount || 0,
      payment_mode: paymentMode,
      device_serial: deviceSerial,
      tid: tid,
      merchant_name: normalizedPayload.merchantName || merchantName,
      merchant_slug: merchantSlug,
      transaction_time: createdTime.toISOString(),
      raw_data: rawDataToStore,
      customer_name: customerName,
      payer_name: payerName,
      username: username,
      txn_type: txnType,
      auth_code: authCode,
      card_number: cardNumber,
      issuing_bank: issuingBank,
      card_classification: cardClassification,
      mid_code: midCode,
      card_brand: cardBrand,
      card_type: cardType,
      currency: currencyCode,
      rrn: rrNumber,
      external_ref: externalRef,
      settlement_status: settlementStatusVal,
      receipt_url: customerReceiptUrl,
      posting_date: postingDateParsed?.toISOString() || null,
      card_txn_type: cardTxnType,
      acquiring_bank: acquiringBank,
    }

    let posResult
    let isNewTransaction = false

    if (existingPosTransaction) {
      const { data, error } = await supabase
        .from('razorpay_pos_transactions')
        .update({ ...posTransactionData, updated_at: new Date().toISOString() })
        .eq('txn_id', txnId)
        .select()
        .single()

      if (error) {
        console.error(`[Webhook/${merchantSlug}] Error updating razorpay_pos_transactions:`, error)
      }
      posResult = data || existingPosTransaction
    } else {
      isNewTransaction = true
      const { data, error } = await supabase
        .from('razorpay_pos_transactions')
        .insert(posTransactionData)
        .select()
        .single()

      if (error) {
        console.error(`[Webhook/${merchantSlug}] Error inserting razorpay_pos_transactions:`, error)
        return NextResponse.json(
          { received: true, processed: false, error: error.message },
          { status: 200 }
        )
      }
      posResult = data
    }

    let retailerMapping: any = null

    if (mappedStatus === 'CAPTURED' && deviceSerial && amount && amount > 0) {
      const { data: deviceMapping, error: mappingError } = await supabase
        .from('pos_device_mapping')
        .select('retailer_id, distributor_id, master_distributor_id')
        .eq('device_serial', deviceSerial)
        .eq('status', 'ACTIVE')
        .maybeSingle()

      if (mappingError) {
        console.error(`[Webhook/${merchantSlug}] Error looking up device mapping:`, mappingError)
      }

      if (deviceMapping && deviceMapping.retailer_id) {
        retailerMapping = deviceMapping

        await supabase
          .from('razorpay_pos_transactions')
          .update({
            retailer_id: deviceMapping.retailer_id,
            distributor_id: deviceMapping.distributor_id,
            master_distributor_id: deviceMapping.master_distributor_id,
            gross_amount: amount,
          })
          .eq('txn_id', txnId)

        console.log(`[Webhook/${merchantSlug}] Transaction ${txnId} CAPTURED for retailer ${deviceMapping.retailer_id}, amount: ₹${amount}`)
      } else {
        console.warn(`[Webhook/${merchantSlug}] No device mapping for device_serial: ${deviceSerial}`)
      }
    }

    if (tid) {
      try {
        const { data: partnerMachine } = await supabase
          .from('partner_pos_machines')
          .select('partner_id, retailer_id, status')
          .eq('terminal_id', tid)
          .eq('status', 'active')
          .maybeSingle()

        if (partnerMachine && partnerMachine.partner_id) {
          const txnTime = createdTime || new Date()

          const { data: existingPosTxn } = await supabase
            .from('pos_transactions')
            .select('id, status')
            .eq('razorpay_txn_id', txnId)
            .gte('txn_time', new Date(txnTime.getTime() - 24 * 60 * 60 * 1000).toISOString())
            .lte('txn_time', new Date(txnTime.getTime() + 24 * 60 * 60 * 1000).toISOString())
            .maybeSingle()

          const posTxnData: any = {
            partner_id: partnerMachine.partner_id,
            retailer_id: partnerMachine.retailer_id,
            terminal_id: tid,
            razorpay_txn_id: txnId,
            external_ref: externalRef,
            amount: amount ? Math.round(amount * 100) : 0,
            status: mappedStatus || 'AUTHORIZED',
            rrn: rrNumber || null,
            card_brand: cardBrand,
            card_type: cardType,
            payment_mode: paymentMode || null,
            settlement_status: settlementStatusVal || 'PENDING',
            device_serial: deviceSerial || null,
            txn_time: txnTime.toISOString(),
            raw_payload: rawDataToStore,
            updated_at: new Date().toISOString(),
            customer_name: customerName,
            payer_name: payerName,
            username: username,
            txn_type: txnType,
            auth_code: authCode,
            card_number: cardNumber,
            issuing_bank: issuingBank,
            card_classification: cardClassification,
            mid: midCode,
            currency: currencyCode,
            receipt_url: customerReceiptUrl,
            posting_date: postingDateParsed?.toISOString() || null,
            card_txn_type: cardTxnType,
            acquiring_bank: acquiringBank,
            merchant_name: normalizedPayload.merchantName || merchantName,
          }

          if (existingPosTxn) {
            const statusOrder: Record<string, number> = { AUTHORIZED: 1, CAPTURED: 2, FAILED: 3, REFUNDED: 4, VOIDED: 5 }
            const newStatusRank = statusOrder[mappedStatus || 'AUTHORIZED'] || 0
            const existingStatusRank = statusOrder[existingPosTxn.status] || 0

            if (newStatusRank > existingStatusRank) {
              await supabase
                .from('pos_transactions')
                .update({
                  status: mappedStatus || 'AUTHORIZED',
                  settlement_status: posTxnData.settlement_status,
                  updated_at: new Date().toISOString()
                })
                .eq('id', existingPosTxn.id)
            }
          } else {
            const { error: posTxnError } = await supabase
              .from('pos_transactions')
              .insert(posTxnData)

            if (posTxnError) {
              console.error(`[Webhook/${merchantSlug}] Error inserting pos_transactions:`, posTxnError)
            } else {
              await supabase
                .from('partner_pos_machines')
                .update({ last_txn_at: txnTime.toISOString() })
                .eq('terminal_id', tid)
            }
          }
        }
      } catch (posTxnError) {
        console.error(`[Webhook/${merchantSlug}] Error syncing to pos_transactions:`, posTxnError)
      }
    }

    const walletCredited = (posResult as { wallet_credited?: boolean })?.wallet_credited ?? false
    return NextResponse.json({
      received: true,
      processed: true,
      merchant: merchantSlug,
      merchantName,
      transactionId: posResult?.id,
      txnId,
      action: isNewTransaction ? 'created' : 'updated',
      status: mappedStatus,
      walletCredited,
      retailerMapped: !!retailerMapping,
    })

  } catch (error: any) {
    console.error(`[Webhook/${merchantSlug}] Error:`, error)
    return NextResponse.json({
      received: true,
      processed: false,
      merchant: merchantSlug,
      error: error.message || 'Unknown error',
    })
  }
}

/** GET: URL verification / health check — Razorpay expects 200 for webhook URL validation */
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
    message: `Razorpay POS notification endpoint for ${merchantName}`,
    merchant: merchantSlug,
    merchantName,
    status: 'active',
  })
}
