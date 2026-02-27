import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { mapTransactionStatus, calculateMDR } from '@/lib/razorpay/service'
import * as crypto from 'crypto'

const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET

export const runtime = 'nodejs' // Force Node.js runtime (Supabase not compatible with Edge Runtime)
export const dynamic = 'force-dynamic'

/**
 * Razorpay Unified Webhook Endpoint
 * 
 * This endpoint receives BOTH:
 * 1. POS transaction notifications (from Razorpay POS devices) - txnId format
 * 2. Standard Razorpay webhooks (from Payment Links, Checkout, etc.) - event/payload format
 * 
 * It auto-detects the payload format and normalizes to a common structure.
 * 
 * CRITICAL FLOW (FIX: Connects POS → Wallet → Hierarchy):
 * 1. Store transaction in razorpay_pos_transactions (for role-based visibility)
 * 2. Look up device_serial in pos_device_mapping to get retailer/distributor/MD
 * 3. If status is CAPTURED and wallet NOT yet credited:
 *    - Calculate MDR
 *    - Credit net amount to retailer wallet
 *    - Process commission distribution
 * 
 * Requirements:
 * - Accept application/json
 * - Verify signature if header present
 * - Use txnId as unique identifier
 * - UPSERT into Supabase
 * - Return 200 OK immediately
 * - Always return HTTP 200 OK (even on errors) to prevent Razorpay retries
 */
export async function POST(request: NextRequest) {
  // Initialize Supabase client at runtime (not during build)
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
    // Get webhook signature from headers (optional - verify if present)
    const signature = request.headers.get('x-razorpay-signature')
    
    // Read raw body for signature verification (if signature is present)
    let rawBody: string | null = null
    let payload: any
    
    if (signature && RAZORPAY_WEBHOOK_SECRET) {
      // Read raw body as text for signature verification
      rawBody = await request.text()
      payload = JSON.parse(rawBody)
      
      // Verify signature
      const expectedSignature = crypto
        .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex')
      
      if (!crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      )) {
        console.error('Invalid webhook signature')
        // Still return 200 to prevent retries, but log the error
        return NextResponse.json(
          { received: true, processed: false, error: 'Invalid signature' },
          { status: 200 }
        )
      }
    } else {
      // No signature verification needed, parse JSON directly
      payload = await request.json()
    }

    // ========================================================
    // AUTO-DETECT PAYLOAD FORMAT: Standard Razorpay vs POS
    // ========================================================
    // Standard Razorpay webhooks have an "event" field (e.g. "payment.captured")
    // POS notifications have a "txnId" field directly
    const isStandardWebhook = !!(payload.event && payload.payload)
    
    let normalizedPayload: any
    
    if (isStandardWebhook) {
      // STANDARD RAZORPAY WEBHOOK FORMAT
      // Extract payment entity from nested structure
      console.log('[Webhook] Standard Razorpay format detected, event:', payload.event)
      
      const eventType = payload.event // e.g. "payment.captured", "payment.authorized", "payment.failed"
      const paymentEntity = payload.payload?.payment?.entity
      
      if (!paymentEntity) {
        console.error('Missing payment entity in standard webhook', payload)
        return NextResponse.json(
          { received: true, processed: false, error: 'Missing payment entity' },
          { status: 200 }
        )
      }
      
      // Map standard Razorpay status to our POS-compatible format
      let rzpStatus = 'PENDING'
      if (eventType === 'payment.captured' || paymentEntity.status === 'captured') {
        rzpStatus = 'AUTHORIZED' // Will be mapped to CAPTURED by mapTransactionStatus
      } else if (eventType === 'payment.authorized' || paymentEntity.status === 'authorized') {
        rzpStatus = 'AUTHORIZED'
      } else if (eventType === 'payment.failed' || paymentEntity.status === 'failed') {
        rzpStatus = 'FAILED'
      } else if (paymentEntity.status === 'refunded') {
        rzpStatus = 'REFUNDED'
      }
      
      // Normalize to POS-like structure for unified processing
      normalizedPayload = {
        txnId: paymentEntity.id, // e.g. "pay_SEUH94IbT0mGz3"
        amount: paymentEntity.amount ? paymentEntity.amount / 100 : 0, // Razorpay standard uses paise → convert to rupees
        currencyCode: paymentEntity.currency?.toUpperCase() || 'INR',
        status: rzpStatus,
        paymentMode: (paymentEntity.method || '').toUpperCase(), // "upi" → "UPI", "card" → "CARD"
        settlementStatus: paymentEntity.status === 'captured' ? 'SETTLED' : 'PENDING',
        customerName: paymentEntity.notes?.customer_name || paymentEntity.email || '',
        payerName: paymentEntity.notes?.customer_name || paymentEntity.contact || '',
        merchantName: paymentEntity.notes?.merchant_name || '',
        rrNumber: paymentEntity.acquirer_data?.rrn || '',
        tid: paymentEntity.terminal_id || '',
        mid: paymentEntity.notes?.mid || '',
        deviceSerial: '',
        txnType: 'PAYMENT_LINK',
        postingDate: paymentEntity.created_at ? new Date(paymentEntity.created_at * 1000).toISOString() : new Date().toISOString(),
        createdTime: paymentEntity.created_at ? paymentEntity.created_at * 1000 : Date.now(), // epoch millis
        // Preserve original fields for reference
        _source: 'standard_webhook',
        _event: eventType,
        _payment_id: paymentEntity.id,
        _order_id: paymentEntity.order_id || '',
        _email: paymentEntity.email || '',
        _contact: paymentEntity.contact || '',
        _description: paymentEntity.description || '',
        _card_info: paymentEntity.card ? {
          network: paymentEntity.card.network,
          type: paymentEntity.card.type,
          last4: paymentEntity.card.last4,
          issuer: paymentEntity.card.issuer
        } : null,
        _vpa: paymentEntity.vpa || null, // UPI VPA
        // Store full original payload for raw JSON view
        _original_payload: payload
      }
      
      console.log(`[Webhook] Normalized standard payment: ${paymentEntity.id}, ₹${normalizedPayload.amount}, ${rzpStatus}, ${normalizedPayload.paymentMode}`)
    } else {
      // POS NOTIFICATION FORMAT (original format)
      console.log('[Webhook] POS notification format detected, txnId:', payload.txnId || payload.id)
      normalizedPayload = { ...payload, _source: 'pos_notification' }
    }

    // ========================================================
    // UNIFIED PROCESSING (works for both formats)
    // ========================================================
    
    // Extract mandatory fields
    const txnId = normalizedPayload.txnId || normalizedPayload.id
    if (!txnId) {
      console.error('Missing txnId in Razorpay notification', normalizedPayload)
      return NextResponse.json(
        { received: true, processed: false, error: 'Missing txnId field' },
        { status: 200 }
      )
    }

    // Map status using the reusable function
    // AUTHORIZED → CAPTURED, FAILED/VOIDED/REFUNDED → FAILED, else → PENDING
    const mappedStatus = mapTransactionStatus(normalizedPayload)

    // Extract fields to persist
    const orderNumber = normalizedPayload.orderNumber || normalizedPayload.externalRefNumber || normalizedPayload._order_id || null
    const amount = normalizedPayload.amount ? parseFloat(normalizedPayload.amount) : null
    const currency = normalizedPayload.currencyCode || normalizedPayload.currency || null
    const paymentMode = normalizedPayload.paymentMode || null
    const settlementStatus = normalizedPayload.settlementStatus || null
    const merchantName = normalizedPayload.merchantName || null
    const rrNumber = normalizedPayload.rrNumber || normalizedPayload.rrn || null
    const acquirerCode = normalizedPayload.acquirerCode || null
    // FIX: Extract device_serial and tid for mapping
    const deviceSerial = normalizedPayload.deviceSerial || normalizedPayload.device_serial || normalizedPayload.terminalId || null
    const tid = normalizedPayload.tid || normalizedPayload.terminalId || null
    
    // Parse created_time (can be epoch milliseconds or ISO string)
    let createdTime: Date | null = null
    if (normalizedPayload.createdTime) {
      // If it's a number, treat as epoch milliseconds
      if (typeof normalizedPayload.createdTime === 'number') {
        createdTime = new Date(normalizedPayload.createdTime)
      } else {
        createdTime = new Date(normalizedPayload.createdTime)
      }
    } else if (normalizedPayload.created_at) {
      createdTime = new Date(normalizedPayload.created_at)
    }
    
    // If no valid date found, use current time
    if (!createdTime || isNaN(createdTime.getTime())) {
      createdTime = new Date()
    }
    
    // Build raw_data: for standard webhooks, include the original webhook payload
    const rawDataToStore = isStandardWebhook 
      ? { ...normalizedPayload, _original_webhook: normalizedPayload._original_payload }
      : payload

    // FIX: Check if transaction already exists in razorpay_pos_transactions
    const { data: existingPosTransaction } = await supabase
      .from('razorpay_pos_transactions')
      .select('id, wallet_credited, retailer_id')
      .eq('txn_id', txnId)
      .maybeSingle()

    // Extract all detailed fields from payload for dedicated columns
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

    // FIX: Store in razorpay_pos_transactions (used by role-based visibility API)
    // Base URL = ASHVAM LEARNING PRIVATE LIMITED
    const posTransactionData: any = {
      txn_id: txnId,
      status: normalizedPayload.status || 'PENDING', // Raw status
      display_status: mappedStatus === 'CAPTURED' ? 'SUCCESS' : mappedStatus === 'FAILED' ? 'FAILED' : 'PENDING',
      amount: amount || 0,
      payment_mode: paymentMode,
      device_serial: deviceSerial,
      tid: tid,
      merchant_name: merchantName,
      merchant_slug: 'ashvam', // Base URL belongs to ASHVAM LEARNING PRIVATE LIMITED
      transaction_time: createdTime.toISOString(),
      raw_data: rawDataToStore,
      // New detailed fields
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
      // UPDATE existing record
      const { data, error } = await supabase
        .from('razorpay_pos_transactions')
        .update({
          ...posTransactionData,
          updated_at: new Date().toISOString()
        })
        .eq('txn_id', txnId)
        .select()
        .single()

      if (error) {
        console.error('Error updating razorpay_pos_transactions:', error)
      }
      posResult = data || existingPosTransaction
    } else {
      // INSERT new record
      isNewTransaction = true
      const { data, error } = await supabase
        .from('razorpay_pos_transactions')
        .insert(posTransactionData)
        .select()
        .single()

      if (error) {
        console.error('Error inserting razorpay_pos_transactions:', error)
        // Return 200 OK but log error
        return NextResponse.json(
          { received: true, processed: false, error: error.message },
          { status: 200 }
        )
      }
      posResult = data
    }

    // ================================================================
    // PULSE PAY FLOW: Do NOT auto-credit wallet on CAPTURED.
    // Instead, store retailer hierarchy info on the transaction.
    // Wallet credit happens later via:
    //   - Pulse Pay (T+0): Retailer selects transactions for instant settlement
    //   - Auto T+1: Cron job processes remaining unsettled transactions next day
    // ================================================================
    let retailerMapping: any = null
    
    if (mappedStatus === 'CAPTURED' && deviceSerial && amount && amount > 0) {
      // Look up device mapping to get retailer hierarchy
      const { data: deviceMapping, error: mappingError } = await supabase
        .from('pos_device_mapping')
        .select('retailer_id, distributor_id, master_distributor_id')
        .eq('device_serial', deviceSerial)
        .eq('status', 'ACTIVE')
        .maybeSingle()

      if (mappingError) {
        console.error('Error looking up device mapping:', mappingError)
      }

      if (deviceMapping && deviceMapping.retailer_id) {
        retailerMapping = deviceMapping
        const grossAmount = amount // Amount is already in rupees from Razorpay POS

        // Store retailer hierarchy on transaction (but do NOT credit wallet)
        // wallet_credited stays false — settlement happens via Pulse Pay or T+1 cron
        await supabase
          .from('razorpay_pos_transactions')
          .update({
            retailer_id: deviceMapping.retailer_id,
            distributor_id: deviceMapping.distributor_id,
            master_distributor_id: deviceMapping.master_distributor_id,
            gross_amount: grossAmount,
            // wallet_credited: false (default - NOT crediting here)
            // settlement_mode: null (unsettled - waiting for Pulse Pay or T+1)
          })
          .eq('txn_id', txnId)

        console.log(`[PulsePay] Transaction ${txnId} CAPTURED for retailer ${deviceMapping.retailer_id}, amount: ₹${grossAmount}. Awaiting settlement via Pulse Pay (T+0) or Auto-T+1.`)
      } else {
        // Device not mapped - log for admin review
        console.warn(`No device mapping found for device_serial: ${deviceSerial}. Transaction stored but cannot be settled until mapped.`)
      }
    }

    // FIX: Also sync to pos_transactions table for Partner API
    // This ensures transactions are visible via the Partner API endpoint
    if (tid) {
      try {
        // Check if terminal_id exists in partner_pos_machines
        const { data: partnerMachine } = await supabase
          .from('partner_pos_machines')
          .select('partner_id, retailer_id, status')
          .eq('terminal_id', tid)
          .eq('status', 'active')
          .maybeSingle()

        if (partnerMachine && partnerMachine.partner_id) {
          // Parse transaction time
          const txnTime = createdTime || new Date()
          
          // Check if transaction already exists in pos_transactions
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
            amount: amount ? Math.round(amount * 100) : 0, // Convert rupees to paisa (BIGINT)
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
            // New detailed fields
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
            merchant_name: merchantName,
          }

          if (existingPosTxn) {
            // Allow status progression: AUTHORIZED → CAPTURED
            const statusOrder: Record<string, number> = { AUTHORIZED: 1, CAPTURED: 2, FAILED: 3, REFUNDED: 4, VOIDED: 5 }
            const newStatusRank = statusOrder[mappedStatus || 'AUTHORIZED'] || 0
            const existingStatusRank = statusOrder[existingPosTxn.status] || 0

            if (newStatusRank > existingStatusRank) {
              // Update status
              await supabase
                .from('pos_transactions')
                .update({
                  status: mappedStatus || 'AUTHORIZED',
                  settlement_status: posTxnData.settlement_status,
                  updated_at: new Date().toISOString()
                })
                .eq('id', existingPosTxn.id)
              
              console.log(`Updated pos_transactions status for txnId: ${txnId}`)
            }
          } else {
            // Insert new transaction
            const { error: posTxnError } = await supabase
              .from('pos_transactions')
              .insert(posTxnData)

            if (posTxnError) {
              console.error('Error inserting into pos_transactions:', posTxnError)
            } else {
              console.log(`Synced transaction to pos_transactions for partner: ${partnerMachine.partner_id}, txnId: ${txnId}`)
              
              // Update last_txn_at on partner_pos_machines
              await supabase
                .from('partner_pos_machines')
                .update({ last_txn_at: txnTime.toISOString() })
                .eq('terminal_id', tid)
            }
          }
        }
      } catch (posTxnError) {
        // Log but don't fail - this is a sync operation
        console.error('Error syncing to pos_transactions (non-blocking):', posTxnError)
      }
    }

    // Return success response (always return 200 to prevent Razorpay retries)
    const walletCredited = (posResult as { wallet_credited?: boolean })?.wallet_credited ?? false
    return NextResponse.json({
      received: true,
      processed: true,
      transactionId: posResult?.id,
      txnId: txnId,
      action: isNewTransaction ? 'created' : 'updated',
      status: mappedStatus,
      walletCredited,
      retailerMapped: !!retailerMapping
    })

  } catch (error: any) {
    console.error('Razorpay POS notification error:', error)
    // Always return 200 to prevent Razorpay from retrying
    // Log error for manual review
    return NextResponse.json({
      received: true,
      processed: false,
      error: error.message || 'Unknown error'
    })
  }
}

// Handle GET for webhook verification (if needed)
export async function GET() {
  return NextResponse.json({
    message: 'Razorpay POS notification endpoint',
    status: 'active',
    description: 'Webhook endpoint for Razorpay POS transaction notifications'
  })
}
