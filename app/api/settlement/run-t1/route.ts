/**
 * T+1 Batch Settlement Cron Job
 * 
 * This endpoint processes pending T+1 transactions and credits retailer wallets.
 * 
 * Should be called daily (e.g., via cron job or scheduled task):
 * - Find transactions with settlement_type = T1
 * - settlement_status = pending
 * - created_at <= yesterday
 * - Credit retailer wallet
 * - Mark settlement_status = completed
 * 
 * Security: Should be protected with API key or authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server-admin';
import {
  getPendingT1Transactions,
  processSettlement,
} from '@/lib/mdr-scheme/settlement.service';
import type { Transaction } from '@/types/mdr-scheme.types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Validate API key for cron job security
 */
function validateApiKey(request: NextRequest): boolean {
  const apiKey = request.headers.get('x-api-key');
  const expectedApiKey = process.env.SETTLEMENT_CRON_API_KEY;

  if (!expectedApiKey) {
    // If no API key is configured, allow access (for development)
    // In production, always require API key
    console.warn('SETTLEMENT_CRON_API_KEY not configured');
    return process.env.NODE_ENV !== 'production';
  }

  return apiKey === expectedApiKey;
}

/**
 * Process T+1 batch settlement
 */
export async function POST(request: NextRequest) {
  try {
    // Validate API key
    if (!validateApiKey(request)) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get optional date parameter (defaults to yesterday)
    const body = await request.json().catch(() => ({}));
    const beforeDate = body.before_date
      ? new Date(body.before_date)
      : new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday

    console.log(
      `[T+1 Settlement] Processing transactions created before: ${beforeDate.toISOString()}`
    );

    // Get pending T+1 transactions
    const pendingTransactions = await getPendingT1Transactions(beforeDate);

    if (pendingTransactions.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No pending T+1 transactions found',
        processed_count: 0,
        failed_count: 0,
        transactions: [],
      });
    }

    console.log(
      `[T+1 Settlement] Found ${pendingTransactions.length} pending transactions`
    );

    // Get paused retailers
    const supabase = getSupabaseAdmin();
    const { data: pausedRows } = await supabase
      .from('retailers')
      .select('partner_id')
      .eq('t1_settlement_paused', true);
    const pausedRetailers = new Set((pausedRows || []).map((r: any) => r.partner_id));
    if (pausedRetailers.size > 0) {
      console.log(`[T+1 Settlement] ${pausedRetailers.size} retailer(s) paused, will be skipped.`);
    }

    // Process each transaction
    const results: Array<{
      transaction_id: string;
      razorpay_payment_id: string;
      success: boolean;
      error?: string;
    }> = [];

    let successCount = 0;
    let failedCount = 0;

    for (const transaction of pendingTransactions) {
      if (pausedRetailers.has(transaction.retailer_id)) {
        console.log(`[T+1 Settlement] Skipping paused retailer: ${transaction.retailer_id}`);
        continue;
      }
      try {
        console.log(
          `[T+1 Settlement] Processing transaction: ${transaction.razorpay_payment_id}`
        );

        // Process settlement (credit retailer wallet)
        const settlementResult = await processSettlement(transaction);

        if (settlementResult.success) {
          successCount++;
          results.push({
            transaction_id: transaction.id,
            razorpay_payment_id: transaction.razorpay_payment_id,
            success: true,
          });
          console.log(
            `[T+1 Settlement] Successfully processed: ${transaction.razorpay_payment_id}`
          );
        } else {
          failedCount++;
          results.push({
            transaction_id: transaction.id,
            razorpay_payment_id: transaction.razorpay_payment_id,
            success: false,
            error: settlementResult.error || 'Unknown error',
          });
          console.error(
            `[T+1 Settlement] Failed to process: ${transaction.razorpay_payment_id}`,
            settlementResult.error
          );
        }
      } catch (error: any) {
        failedCount++;
        results.push({
          transaction_id: transaction.id,
          razorpay_payment_id: transaction.razorpay_payment_id,
          success: false,
          error: error.message || 'Unknown error',
        });
        console.error(
          `[T+1 Settlement] Error processing transaction: ${transaction.razorpay_payment_id}`,
          error
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${successCount} transactions successfully, ${failedCount} failed`,
      processed_count: successCount,
      failed_count: failedCount,
      total_count: pendingTransactions.length,
      before_date: beforeDate.toISOString(),
      results,
    });
  } catch (error: any) {
    console.error('[T+1 Settlement] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to process T+1 settlement',
      },
      { status: 500 }
    );
  }
}

/**
 * GET handler for status check
 */
export async function GET(request: NextRequest) {
  try {
    // Validate API key
    if (!validateApiKey(request)) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get pending T+1 transactions count
    const pendingTransactions = await getPendingT1Transactions();

    return NextResponse.json({
      success: true,
      pending_count: pendingTransactions.length,
      message: 'T+1 Settlement Cron Job is active',
      endpoint: '/api/settlement/run-t1',
      method: 'POST',
    });
  } catch (error: any) {
    console.error('[T+1 Settlement] Status check error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to check status',
      },
      { status: 500 }
    );
  }
}

