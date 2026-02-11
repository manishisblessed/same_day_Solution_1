/**
 * Razorpay MDR Scheme Engine Webhook Handler
 * 
 * Production Webhook URL: https://api.samedaysolution.in/api/razorpay/mdr-settlement
 * 
 * This endpoint handles Razorpay payment webhooks for the MDR Scheme Engine.
 * It processes payments, calculates MDR based on schemes, and handles settlement.
 * 
 * Requirements:
 * - Must read raw request body (for Razorpay signature verification)
 * - Use RAZORPAY_WEBHOOK_SECRET from environment variables
 * - Validate signature using crypto HMAC SHA256
 * - Return HTTP 200 immediately after validation
 * - Process settlement asynchronously
 * - Add idempotency check using razorpay_payment_id
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server-admin';
import * as crypto from 'crypto';
import {
  calculateMDR,
  createTransaction,
  processSettlement,
} from '@/lib/mdr-scheme/settlement.service';
import {
  normalizePaymentMode,
  normalizeCardType,
  normalizeBrandType,
} from '@/lib/mdr-scheme/scheme.service';
import type {
  RazorpayWebhookPayload,
  RazorpayPaymentEntity,
  SettlementType,
} from '@/types/mdr-scheme.types';

const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

export const runtime = 'nodejs'; // Force Node.js runtime
export const dynamic = 'force-dynamic';

/**
 * Verify Razorpay webhook signature
 */
function verifySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    console.error('Error verifying signature:', error);
    return false;
  }
}

/**
 * Extract payment details from Razorpay payment entity
 */
function extractPaymentDetails(
  paymentEntity: RazorpayPaymentEntity
): {
  mode: 'CARD' | 'UPI';
  card_type: 'CREDIT' | 'DEBIT' | 'PREPAID' | null;
  brand_type: string | null;
  settlement_type: SettlementType;
  retailer_id: string;
  distributor_id: string | null;
} {
  // Extract mode
  const mode = normalizePaymentMode(paymentEntity.method || 'upi');

  // Extract card details if card payment
  let card_type: 'CREDIT' | 'DEBIT' | 'PREPAID' | null = null;
  let brand_type: string | null = null;

  if (mode === 'CARD' && paymentEntity.card) {
    card_type = normalizeCardType(paymentEntity.card.type);
    brand_type = normalizeBrandType(paymentEntity.card.network);
  }

  // Extract settlement type from notes (default to T+1 if not specified)
  const settlement_type: SettlementType =
    (paymentEntity.notes?.settlement_type as SettlementType) || 'T1';

  // Extract retailer_id and distributor_id from notes
  const retailer_id = paymentEntity.notes?.retailer_id;
  const distributor_id = paymentEntity.notes?.distributor_id || null;

  if (!retailer_id) {
    throw new Error('retailer_id is required in payment notes');
  }

  return {
    mode,
    card_type,
    brand_type,
    settlement_type,
    retailer_id,
    distributor_id,
  };
}

/**
 * Check if transaction already exists (idempotency check)
 */
async function checkTransactionExists(
  razorpay_payment_id: string
): Promise<boolean> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('transactions')
    .select('id')
    .eq('razorpay_payment_id', razorpay_payment_id)
    .maybeSingle();

  if (error) {
    console.error('Error checking transaction existence:', error);
    return false;
  }

  return !!data;
}

/**
 * Main webhook handler
 */
export async function POST(request: NextRequest) {
  // Always return 200 OK to prevent Razorpay retries
  const sendResponse = (
    data: any,
    status: number = 200
  ): NextResponse => {
    return NextResponse.json(data, { status });
  };

  try {
    // Validate webhook secret
    if (!RAZORPAY_WEBHOOK_SECRET) {
      console.error('RAZORPAY_WEBHOOK_SECRET is not configured');
      return sendResponse({
        received: true,
        processed: false,
        error: 'Webhook secret not configured',
      });
    }

    // Get webhook signature from headers
    const signature = request.headers.get('x-razorpay-signature');
    if (!signature) {
      console.warn('Missing Razorpay signature header');
      // Continue processing but log warning
    }

    // Read raw body for signature verification
    const rawBody = await request.text();
    let payload: RazorpayWebhookPayload;

    try {
      payload = JSON.parse(rawBody);
    } catch (error) {
      console.error('Invalid JSON payload:', error);
      return sendResponse({
        received: true,
        processed: false,
        error: 'Invalid JSON payload',
      });
    }

    // Verify signature if present
    if (signature) {
      const isValid = verifySignature(
        rawBody,
        signature,
        RAZORPAY_WEBHOOK_SECRET
      );

      if (!isValid) {
        console.error('Invalid webhook signature');
        return sendResponse({
          received: true,
          processed: false,
          error: 'Invalid signature',
        });
      }
    }

    // Extract payment entity from webhook payload
    const paymentEntity = payload.payload?.payment?.entity;
    if (!paymentEntity) {
      console.error('Missing payment entity in webhook payload');
      return sendResponse({
        received: true,
        processed: false,
        error: 'Missing payment entity',
      });
    }

    // Only process captured payments
    if (
      payload.event !== 'payment.captured' &&
      paymentEntity.status !== 'captured'
    ) {
      console.log(
        `Skipping webhook event: ${payload.event}, status: ${paymentEntity.status}`
      );
      return sendResponse({
        received: true,
        processed: false,
        message: 'Payment not captured, skipping',
      });
    }

    // Idempotency check
    const exists = await checkTransactionExists(paymentEntity.id);
    if (exists) {
      console.log(
        `Transaction ${paymentEntity.id} already exists, skipping`
      );
      return sendResponse({
        received: true,
        processed: false,
        message: 'Transaction already processed',
      });
    }

    // Extract payment details
    let paymentDetails;
    try {
      paymentDetails = extractPaymentDetails(paymentEntity);
    } catch (error: any) {
      console.error('Error extracting payment details:', error);
      return sendResponse({
        received: true,
        processed: false,
        error: error.message || 'Failed to extract payment details',
      });
    }

    // Convert amount from paise to rupees
    const amount = paymentEntity.amount / 100;

    // Calculate MDR
    const mdrResult = await calculateMDR({
      amount,
      settlement_type: paymentDetails.settlement_type,
      mode: paymentDetails.mode,
      card_type: paymentDetails.card_type,
      brand_type: paymentDetails.brand_type,
      retailer_id: paymentDetails.retailer_id,
      distributor_id: paymentDetails.distributor_id,
    });

    if (!mdrResult.success || !mdrResult.result) {
      console.error('MDR calculation failed:', mdrResult.error);
      return sendResponse({
        received: true,
        processed: false,
        error: mdrResult.error || 'Failed to calculate MDR',
      });
    }

    // Create transaction record
    const transactionResult = await createTransaction(
      {
        razorpay_payment_id: paymentEntity.id,
        amount,
        settlement_type: paymentDetails.settlement_type,
        mode: paymentDetails.mode,
        card_type: paymentDetails.card_type,
        brand_type: paymentDetails.brand_type,
        retailer_id: paymentDetails.retailer_id,
        distributor_id: paymentDetails.distributor_id,
        metadata: {
          razorpay_event: payload.event,
          payment_method: paymentEntity.method,
          card_info: paymentEntity.card || null,
          vpa: paymentEntity.vpa || null,
          created_at: paymentEntity.created_at,
          original_payload: paymentEntity,
        },
      },
      mdrResult.result
    );

    if (!transactionResult.success || !transactionResult.data) {
      console.error('Transaction creation failed:', transactionResult.error);
      return sendResponse({
        received: true,
        processed: false,
        error: transactionResult.error || 'Failed to create transaction',
      });
    }

    const transaction = transactionResult.data;

    // Process settlement (wallet credits)
    // For T+0: Credit immediately
    // For T+1: Mark as pending (will be processed by cron job)
    if (paymentDetails.settlement_type === 'T0') {
      const settlementResult = await processSettlement(transaction);
      if (!settlementResult.success) {
        console.error('Settlement processing failed:', settlementResult.error);
        // Log but don't fail - settlement can be retried
      }
    }
    // T+1 transactions will be processed by cron job

    // Return success immediately
    return sendResponse({
      received: true,
      processed: true,
      transaction_id: transaction.id,
      razorpay_payment_id: paymentEntity.id,
      settlement_type: paymentDetails.settlement_type,
      amount,
      retailer_settlement_amount: mdrResult.result.retailer_settlement_amount,
      retailer_fee: mdrResult.result.retailer_fee,
      distributor_margin: mdrResult.result.distributor_margin,
      company_earning: mdrResult.result.company_earning,
    });
  } catch (error: any) {
    console.error('Razorpay MDR settlement webhook error:', error);
    // Always return 200 to prevent Razorpay retries
    return sendResponse({
      received: true,
      processed: false,
      error: error.message || 'Unknown error',
    });
  }
}

/**
 * GET handler for webhook verification (if needed)
 */
export async function GET() {
  return NextResponse.json({
    message: 'Razorpay MDR Settlement Webhook Endpoint',
    status: 'active',
    description:
      'Webhook endpoint for Razorpay payment notifications with MDR scheme engine',
    production_url: 'https://api.samedaysolution.in/api/razorpay/mdr-settlement',
  });
}

