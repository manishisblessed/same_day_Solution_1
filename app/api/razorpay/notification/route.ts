import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { mapTransactionStatus, calculateMDR } from '@/lib/razorpay/service'
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
    // AUTHORIZED → CAPTURED, FAILED/VOIDED/REFUNDED → FAILED, else → PENDING
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
    // FIX: Extract device_serial and tid for mapping
    const deviceSerial = payload.deviceSerial || payload.device_serial || payload.terminalId || null
    const tid = payload.tid || payload.terminalId || null
    
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

    // FIX: Check if transaction already exists in razorpay_pos_transactions
    const { data: existingPosTransaction } = await supabase
      .from('razorpay_pos_transactions')
      .select('id, wallet_credited, retailer_id')
      .eq('txn_id', txnId)
      .maybeSingle()

    // FIX: Store in razorpay_pos_transactions (used by role-based visibility API)
    const posTransactionData: any = {
      txn_id: txnId,
      status: payload.status || 'PENDING', // Raw status
      display_status: mappedStatus === 'CAPTURED' ? 'SUCCESS' : mappedStatus === 'FAILED' ? 'FAILED' : 'PENDING',
      amount: amount || 0,
      payment_mode: paymentMode,
      device_serial: deviceSerial,
      tid: tid,
      merchant_name: merchantName,
      transaction_time: createdTime.toISOString(),
      raw_data: payload
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

    // FIX: Process wallet credit for CAPTURED transactions
    let walletCredited = existingPosTransaction?.wallet_credited || false
    let retailerMapping: any = null
    
    if (mappedStatus === 'CAPTURED' && !walletCredited && deviceSerial && amount && amount > 0) {
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
        
        // Calculate MDR
        const grossAmount = amount // Amount is already in rupees from Razorpay POS
        const { mdr, netAmount } = calculateMDR(grossAmount)

        try {
          // FIX: Credit wallet using add_ledger_entry (atomic operation with row-level locking)
          const { data: ledgerId, error: ledgerError } = await supabase.rpc('add_ledger_entry', {
            p_user_id: deviceMapping.retailer_id,
            p_user_role: 'retailer',
            p_wallet_type: 'primary',
            p_fund_category: 'online', // POS transactions are online fund category
            p_service_type: 'pos',
            p_tx_type: 'POS_CREDIT',
            p_credit: netAmount,
            p_debit: 0,
            p_reference_id: txnId,
            p_transaction_id: posResult?.id || null,
            p_status: 'completed',
            p_remarks: `POS Transaction Credit - TID: ${tid || 'N/A'}, RRN: ${rrNumber || 'N/A'}, Gross: ₹${grossAmount}, MDR: ₹${mdr}, Net: ₹${netAmount}`
          })

          if (ledgerError) {
            console.error('Error crediting wallet:', ledgerError)
          } else {
            walletCredited = true
            console.log(`Wallet credited for retailer ${deviceMapping.retailer_id}, amount: ${netAmount}, ledger_id: ${ledgerId}`)

            // Update transaction with wallet credit info
            await supabase
              .from('razorpay_pos_transactions')
              .update({
                wallet_credited: true,
                wallet_credit_id: ledgerId,
                retailer_id: deviceMapping.retailer_id,
                distributor_id: deviceMapping.distributor_id,
                master_distributor_id: deviceMapping.master_distributor_id,
                gross_amount: grossAmount,
                mdr_amount: mdr,
                net_amount: netAmount
              })
              .eq('txn_id', txnId)

            // FIX: Process commission distribution (if applicable)
            if (deviceMapping.distributor_id || deviceMapping.master_distributor_id) {
              try {
                // Commission calculation uses process_transaction_commission RPC if available
                // This distributes commission to distributor and master_distributor
                const { error: commissionError } = await supabase.rpc('process_transaction_commission', {
                  p_transaction_id: posResult?.id,
                  p_transaction_type: 'pos',
                  p_gross_amount: grossAmount,
                  p_retailer_id: deviceMapping.retailer_id,
                  p_distributor_id: deviceMapping.distributor_id || null,
                  p_master_distributor_id: deviceMapping.master_distributor_id || null
                })

                if (commissionError) {
                  // Log but don't fail - commission can be processed manually
                  console.error('Error processing commission (non-blocking):', commissionError)
                }
              } catch (commError) {
                console.error('Commission processing error (non-blocking):', commError)
              }
            }
          }
        } catch (walletError) {
          console.error('Wallet credit error:', walletError)
        }
      } else {
        // Device not mapped - log for admin review
        console.warn(`No device mapping found for device_serial: ${deviceSerial}. Transaction stored but wallet NOT credited.`)
      }
    }

    // Return success response (always return 200 to prevent Razorpay retries)
    return NextResponse.json({
      received: true,
      processed: true,
      transactionId: posResult?.id,
      txnId: txnId,
      action: isNewTransaction ? 'created' : 'updated',
      status: mappedStatus,
      walletCredited: walletCredited,
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
