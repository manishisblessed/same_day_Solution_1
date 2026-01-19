import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { mapTransactionStatus } from '@/lib/razorpay/service'
import * as crypto from 'crypto'

const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET

export const runtime = 'nodejs' // Force Node.js runtime (Supabase not compatible with Edge Runtime)
export const dynamic = 'force-dynamic'

/**
 * Razorpay POS Notification Webhook Endpoint
 * 
 * This endpoint receives transaction notifications from Razorpay POS devices.
 * It implements idempotency using txnId as the unique key (UPSERT logic).
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

    // Extract mandatory fields
    const txnId = payload.txnId || payload.id
    if (!txnId) {
      console.error('Missing txnId in Razorpay notification', payload)
      // Return 200 OK but log error
      return NextResponse.json(
        { received: true, processed: false, error: 'Missing txnId field' },
        { status: 200 }
      )
    }

    // Map status using the reusable function
    const mappedStatus = mapTransactionStatus(payload)

    // Extract fields to persist
    const orderNumber = payload.orderNumber || payload.externalRefNumber || null
    const amount = payload.amount ? parseFloat(payload.amount) : null
    const currency = payload.currencyCode || payload.currency || null
    const paymentMode = payload.paymentMode || null
    const settlementStatus = payload.settlementStatus || null
    const merchantName = payload.merchantName || null
    const rrNumber = payload.rrNumber || payload.rrn || null
    const acquirerCode = payload.acquirerCode || null
    
    // Parse created_time (can be epoch milliseconds or ISO string)
    let createdTime: Date | null = null
    if (payload.createdTime) {
      // If it's a number, treat as epoch milliseconds
      if (typeof payload.createdTime === 'number') {
        createdTime = new Date(payload.createdTime)
      } else {
        createdTime = new Date(payload.createdTime)
      }
    } else if (payload.created_at) {
      createdTime = new Date(payload.created_at)
    }
    
    // If no valid date found, use current time
    if (!createdTime || isNaN(createdTime.getTime())) {
      createdTime = new Date()
    }

    // IDEMPOTENCY: UPSERT logic using txn_id as unique key
    // If txn_id exists, update the record; otherwise, insert new record
    const { data: existingTransaction, error: checkError } = await supabase
      .from('razorpay_transactions')
      .select('id')
      .eq('txn_id', txnId)
      .maybeSingle()

    if (checkError && checkError.code !== 'PGRST116') {
      // PGRST116 = no rows returned (expected for new transactions)
      console.error('Error checking existing transaction:', checkError)
      // Continue with insert/update anyway
    }

    const transactionData = {
      txn_id: txnId,
      order_number: orderNumber,
      amount: amount,
      currency: currency,
      payment_mode: paymentMode,
      status: mappedStatus,
      settlement_status: settlementStatus,
      merchant_name: merchantName,
      rr_number: rrNumber,
      acquirer_code: acquirerCode,
      created_time: createdTime.toISOString(),
      raw_payload: payload // Store full payload for audit
    }

    let result
    if (existingTransaction) {
      // UPDATE existing record (idempotency: same txn_id received again)
      const { data, error } = await supabase
        .from('razorpay_transactions')
        .update(transactionData)
        .eq('txn_id', txnId)
        .select()
        .single()

      if (error) {
        console.error('Error updating Razorpay transaction:', error)
        // Return 200 OK but log error
        return NextResponse.json(
          { 
            received: true, 
            processed: false,
            error: error.message 
          },
          { status: 200 }
        )
      }

      result = data
    } else {
      // INSERT new record
      const { data, error } = await supabase
        .from('razorpay_transactions')
        .insert(transactionData)
        .select()
        .single()

      if (error) {
        console.error('Error inserting Razorpay transaction:', error)
        // Return 200 OK but log error
        return NextResponse.json(
          { 
            received: true, 
            processed: false,
            error: error.message 
          },
          { status: 200 }
        )
      }

      result = data
    }

    // Return success response (always return 200 to prevent Razorpay retries)
    return NextResponse.json({
      received: true,
      processed: true,
      transactionId: result?.id,
      txnId: txnId,
      action: existingTransaction ? 'updated' : 'created'
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
