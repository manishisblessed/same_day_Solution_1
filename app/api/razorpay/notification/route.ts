import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const dynamic = 'force-dynamic'

/**
 * Razorpay POS Notification Webhook Endpoint
 * 
 * This endpoint receives transaction notifications from Razorpay POS devices.
 * It implements idempotency using txnId as the unique key (UPSERT logic).
 * 
 * Phase 1: Display-only feature - no wallet crediting, no settlement logic
 */
export async function POST(request: NextRequest) {
  try {
    // Parse the notification payload
    const payload = await request.json()

    // Extract mandatory fields
    const txnId = payload.txnId || payload.id
    if (!txnId) {
      console.error('Missing txnId in Razorpay notification')
      return NextResponse.json(
        { error: 'Missing txnId field', received: true },
        { status: 400 }
      )
    }

    // Extract status
    const rawStatus = payload.status || 'PENDING'
    
    // Derive display status
    let displayStatus: 'SUCCESS' | 'FAILED' | 'PENDING'
    if (rawStatus === 'AUTHORIZED') {
      displayStatus = 'SUCCESS'
    } else if (rawStatus === 'FAILED') {
      displayStatus = 'FAILED'
    } else {
      displayStatus = 'PENDING'
    }

    // Extract amount (convert from paise to rupees if needed, or use as-is)
    let amount = payload.amount || 0
    // If amount seems too large (likely in paise), convert to rupees
    if (amount > 1000000) {
      amount = amount / 100
    }

    // Extract payment mode
    const paymentMode = payload.paymentMode || null

    // Extract device information
    const deviceSerial = payload.deviceSerial || null
    const tid = payload.tid || null

    // Extract merchant name
    const merchantName = payload.merchantName || null

    // Extract transaction time
    // Try createdTime first (epoch milliseconds), then chargeSlipDate (ISO string)
    let transactionTime: Date | null = null
    if (payload.createdTime) {
      transactionTime = new Date(payload.createdTime)
    } else if (payload.chargeSlipDate) {
      transactionTime = new Date(payload.chargeSlipDate)
    } else if (payload.postingDate) {
      transactionTime = new Date(payload.postingDate)
    }
    
    // If no valid date found, use current time
    if (!transactionTime || isNaN(transactionTime.getTime())) {
      transactionTime = new Date()
    }

    // IDEMPOTENCY: UPSERT logic using txnId as unique key
    // If txnId exists, update the record; otherwise, insert new record
    const { data: existingTransaction, error: checkError } = await supabase
      .from('razorpay_pos_transactions')
      .select('id')
      .eq('txn_id', txnId)
      .single()

    if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error checking existing transaction:', checkError)
      // Continue with insert/update anyway
    }

    const transactionData = {
      txn_id: txnId,
      status: rawStatus,
      display_status: displayStatus,
      amount: amount,
      payment_mode: paymentMode,
      device_serial: deviceSerial,
      tid: tid,
      merchant_name: merchantName,
      transaction_time: transactionTime.toISOString(),
      updated_at: new Date().toISOString(),
      raw_data: payload // Store full payload for reference
    }

    let result
    if (existingTransaction) {
      // UPDATE existing record (idempotency: same txnId received again)
      const { data, error } = await supabase
        .from('razorpay_pos_transactions')
        .update({
          status: rawStatus,
          display_status: displayStatus,
          amount: amount,
          payment_mode: paymentMode,
          device_serial: deviceSerial,
          tid: tid,
          merchant_name: merchantName,
          transaction_time: transactionTime.toISOString(),
          updated_at: new Date().toISOString(),
          raw_data: payload
        })
        .eq('txn_id', txnId)
        .select()
        .single()

      if (error) {
        console.error('Error updating Razorpay POS transaction:', error)
        return NextResponse.json(
          { 
            received: true, 
            processed: false,
            error: error.message 
          },
          { status: 500 }
        )
      }

      result = data
    } else {
      // INSERT new record
      const { data, error } = await supabase
        .from('razorpay_pos_transactions')
        .insert({
          ...transactionData,
          created_at: new Date().toISOString()
        })
        .select()
        .single()

      if (error) {
        console.error('Error inserting Razorpay POS transaction:', error)
        return NextResponse.json(
          { 
            received: true, 
            processed: false,
            error: error.message 
          },
          { status: 500 }
        )
      }

      result = data
    }

    // Return success response (always return 200 to prevent Razorpay retries)
    return NextResponse.json({
      received: true,
      processed: true,
      transactionId: result.id,
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
    phase: 1,
    description: 'Display-only feature - no wallet or settlement logic'
  })
}

