/**
 * Pulse Pay (₹) API - Instant T+0 Settlement for POS Transactions
 * (Formerly InstaCash)
 * 
 * POST /api/pos/instacash
 *   - Retailer selects specific unsettled POS transactions
 *   - Calculates MDR at T+0 rates (card_type + brand_type + card_classification)
 *   - Credits net amount to retailer wallet
 *   - Creates audit batch for tracking
 * 
 * GET /api/pos/instacash?batch_id=xxx
 *   - Get details of a specific Pulse Pay batch
 * 
 * GET /api/pos/instacash/unsettled
 *   - Get all unsettled transactions for the current retailer
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import {
  calculateMDR as calculateSchemeMDR,
} from '@/lib/mdr-scheme/settlement.service'
import type { SettlementType } from '@/types/mdr-scheme.types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST - Process Pulse Pay (Instant T+0 Settlement)
 * 
 * Body:
 * {
 *   transaction_ids: string[]  // Array of razorpay_pos_transactions.id
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user
    const { user, method } = await getCurrentUserWithFallback(request)
    if (!user || !user.partner_id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Please log in.' },
        { status: 401 }
      )
    }

    // Only retailers can use Pulse Pay
    if (user.role !== 'retailer' && user.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: 'Pulse Pay is only available for retailers.' },
        { status: 403 }
      )
    }

    // 2. Parse request body
    const body = await request.json()
    const { transaction_ids } = body

    if (!transaction_ids || !Array.isArray(transaction_ids) || transaction_ids.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Please select at least one transaction for Pulse Pay.' },
        { status: 400 }
      )
    }

    if (transaction_ids.length > 50) {
      return NextResponse.json(
        { success: false, error: 'Maximum 50 transactions per Pulse Pay batch.' },
        { status: 400 }
      )
    }

    const supabase = getSupabaseAdmin()
    const retailerId = user.partner_id

    // 3. Resolve retailer's TIDs and device serials (same logic as GET /api/razorpay/transactions)
    let retailerTids: string[] = []
    let retailerSerials: string[] = []

    const { data: deviceMappings } = await supabase
      .from('pos_device_mapping')
      .select('device_serial, tid')
      .eq('retailer_id', retailerId)
      .eq('status', 'ACTIVE')

    if (deviceMappings) {
      retailerSerials.push(...deviceMappings.map((m: any) => m.device_serial).filter(Boolean))
      retailerTids.push(...deviceMappings.map((m: any) => m.tid).filter(Boolean))
    }

    const { data: retailerMachines } = await supabase
      .from('pos_machines')
      .select('tid, serial_number')
      .eq('retailer_id', retailerId)
      .in('status', ['active', 'inactive'])

    if (retailerMachines) {
      retailerTids.push(...retailerMachines.map((m: any) => m.tid).filter(Boolean))
      retailerSerials.push(...retailerMachines.map((m: any) => m.serial_number).filter(Boolean))
    }

    retailerTids = Array.from(new Set(retailerTids))
    retailerSerials = Array.from(new Set(retailerSerials))

    // 4. Fetch and validate selected transactions
    const { data: transactions, error: txnError } = await supabase
      .from('razorpay_pos_transactions')
      .select('*')
      .in('id', transaction_ids)
      .or('display_status.ilike.SUCCESS,display_status.ilike.CAPTURED')

    if (txnError) {
      console.error('[PulsePay] Error fetching transactions:', txnError)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch transactions.' },
        { status: 500 }
      )
    }

    // Filter to only transactions belonging to this retailer (by TID/device_serial or retailer_id)
    const ownedTransactions = (transactions || []).filter((t: any) =>
      t.retailer_id === retailerId ||
      (t.tid && retailerTids.includes(t.tid)) ||
      (t.device_serial && retailerSerials.includes(t.device_serial))
    )

    console.log(`[PulsePay] Query: retailer=${retailerId}, requested=${transaction_ids.length}, found=${transactions?.length || 0}, owned=${ownedTransactions.length}, TIDs=[${retailerTids.join(',')}], serials=[${retailerSerials.join(',')}]`)

    if (ownedTransactions.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid transactions found. Ensure they belong to you and are captured.' },
        { status: 400 }
      )
    }

    // 5. Duplicate check - ensure none are already settled
    const alreadySettled = ownedTransactions.filter(t => t.wallet_credited === true || t.settlement_mode)
    if (alreadySettled.length > 0) {
      const settledIds = alreadySettled.map(t => t.txn_id).join(', ')
      return NextResponse.json(
        { 
          success: false, 
          error: `${alreadySettled.length} transaction(s) already settled: ${settledIds}. Please deselect them.`,
          already_settled: alreadySettled.map(t => ({ id: t.id, txn_id: t.txn_id, settlement_mode: t.settlement_mode }))
        },
        { status: 409 }
      )
    }

    // 6. Additional duplicate check - ensure not in any pending Pulse Pay batch
    const txnIds = ownedTransactions.map(t => t.id)
    const { data: existingBatchItems } = await supabase
      .from('instacash_batch_items')
      .select('pos_transaction_id, txn_id, status')
      .in('pos_transaction_id', txnIds)
      .in('status', ['pending', 'settled'])

    if (existingBatchItems && existingBatchItems.length > 0) {
      return NextResponse.json(
        { 
          success: false, 
          error: `${existingBatchItems.length} transaction(s) are already in a pending/settled Pulse Pay batch.`,
          conflicting: existingBatchItems
        },
        { status: 409 }
      )
    }

    // 6. Get retailer hierarchy for MDR calculation
    const { data: retailerData } = await supabase
      .from('retailers')
      .select('distributor_id, master_distributor_id')
      .eq('partner_id', retailerId)
      .maybeSingle()

    const distributorId = retailerData?.distributor_id || null

    // 7. Create Pulse Pay batch
    const { data: batch, error: batchError } = await supabase
      .from('instacash_batches')
      .insert({
        retailer_id: retailerId,
        total_transactions: ownedTransactions.length,
        status: 'processing',
        metadata: {
          user_agent: request.headers.get('user-agent'),
          ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
        }
      })
      .select()
      .single()

    if (batchError || !batch) {
      console.error('[PulsePay] Error creating batch:', batchError)
      return NextResponse.json(
        { success: false, error: 'Failed to create Pulse Pay batch.' },
        { status: 500 }
      )
    }

    console.log(`[PulsePay] Batch ${batch.id} created for retailer ${retailerId} with ${ownedTransactions.length} transactions`)

    // 8. Process each transaction: calculate MDR and create batch items
    let totalGrossAmount = 0
    let totalMdrAmount = 0
    let totalNetAmount = 0
    let successCount = 0
    let failedCount = 0
    const batchItems: any[] = []

    for (const txn of ownedTransactions) {
      const grossAmount = parseFloat(txn.gross_amount || txn.amount || '0')
      if (grossAmount <= 0) {
        batchItems.push({
          batch_id: batch.id,
          pos_transaction_id: txn.id,
          txn_id: txn.txn_id,
          gross_amount: grossAmount,
          mdr_rate: 0,
          mdr_amount: 0,
          net_amount: 0,
          card_type: txn.card_type,
          card_brand: txn.card_brand,
          card_classification: txn.card_classification,
          payment_mode: txn.payment_mode,
          status: 'skipped',
          error_message: 'Zero or negative amount'
        })
        failedCount++
        continue
      }

      // Calculate MDR using the scheme engine (T+0 rate with card_classification)
      const paymentMode = (txn.payment_mode || 'CARD').toUpperCase()
      const mdrInput = {
        amount: grossAmount,
        settlement_type: 'T0' as SettlementType,
        mode: paymentMode.includes('UPI') ? 'UPI' as const : 'CARD' as const,
        card_type: txn.card_type?.toUpperCase() || null,
        brand_type: txn.card_brand || null,
        card_classification: txn.card_classification || null,
        retailer_id: retailerId,
        distributor_id: distributorId,
      }

      const mdrResult = await calculateSchemeMDR(mdrInput)

      if (mdrResult.success && mdrResult.result) {
        const mdrRate = mdrResult.result.retailer_mdr
        const mdrAmount = mdrResult.result.retailer_fee
        const netAmount = mdrResult.result.retailer_settlement_amount

        totalGrossAmount += grossAmount
        totalMdrAmount += mdrAmount
        totalNetAmount += netAmount
        successCount++

        batchItems.push({
          batch_id: batch.id,
          pos_transaction_id: txn.id,
          txn_id: txn.txn_id,
          gross_amount: grossAmount,
          mdr_rate: mdrRate,
          mdr_amount: mdrAmount,
          net_amount: netAmount,
          card_type: txn.card_type,
          card_brand: txn.card_brand,
          card_classification: txn.card_classification,
          payment_mode: txn.payment_mode,
          scheme_id: mdrResult.result.scheme_id || null,
          scheme_type: mdrResult.result.scheme_type || null,
          status: 'pending',
        })
      } else {
        // MDR calculation failed - skip this transaction
        failedCount++
        batchItems.push({
          batch_id: batch.id,
          pos_transaction_id: txn.id,
          txn_id: txn.txn_id,
          gross_amount: grossAmount,
          mdr_rate: 0,
          mdr_amount: 0,
          net_amount: 0,
          card_type: txn.card_type,
          card_brand: txn.card_brand,
          card_classification: txn.card_classification,
          payment_mode: txn.payment_mode,
          status: 'failed',
          error_message: mdrResult.error || 'MDR calculation failed'
        })
        console.warn(`[PulsePay] MDR calc failed for txn ${txn.txn_id}: ${mdrResult.error}`)
      }
    }

    // 9. Insert batch items
    if (batchItems.length > 0) {
      const { error: itemsError } = await supabase
        .from('instacash_batch_items')
        .insert(batchItems)

      if (itemsError) {
        console.error('[PulsePay] Error inserting batch items:', itemsError)
        // Update batch status to failed
        await supabase
          .from('instacash_batches')
          .update({ status: 'failed', completed_at: new Date().toISOString() })
          .eq('id', batch.id)
        return NextResponse.json(
          { success: false, error: 'Failed to process Pulse Pay batch items.' },
          { status: 500 }
        )
      }
    }

    // 10. Credit wallet with total net amount (single atomic wallet credit)
    let walletCreditId: string | null = null
    if (totalNetAmount > 0) {
      try {
        const { data: ledgerId, error: ledgerError } = await supabase.rpc('add_ledger_entry', {
          p_user_id: retailerId,
          p_user_role: 'retailer',
          p_wallet_type: 'primary',
          p_fund_category: 'online',
          p_service_type: 'pos',
          p_tx_type: 'POS_CREDIT',
          p_credit: totalNetAmount,
          p_debit: 0,
          p_reference_id: `INSTACASH-${batch.id}`,
          p_transaction_id: batch.id,
          p_status: 'completed',
          p_remarks: `⚡ Pulse Pay - ${successCount} txn(s), Gross: ₹${totalGrossAmount.toFixed(2)}, MDR: ₹${totalMdrAmount.toFixed(2)}, Net: ₹${totalNetAmount.toFixed(2)}`
        })

        if (ledgerError) {
          console.error('[PulsePay] Wallet credit error:', ledgerError)
          // Mark batch as failed
          await supabase
            .from('instacash_batches')
            .update({ status: 'failed', completed_at: new Date().toISOString() })
            .eq('id', batch.id)
          return NextResponse.json(
            { success: false, error: 'Failed to credit wallet. Pulse Pay batch cancelled.' },
            { status: 500 }
          )
        }

        walletCreditId = ledgerId
        console.log(`[PulsePay] Wallet credited: ₹${totalNetAmount.toFixed(2)} for retailer ${retailerId}, ledger_id: ${ledgerId}`)
      } catch (walletErr) {
        console.error('[PulsePay] Wallet credit exception:', walletErr)
        await supabase
          .from('instacash_batches')
          .update({ status: 'failed', completed_at: new Date().toISOString() })
          .eq('id', batch.id)
        return NextResponse.json(
          { success: false, error: 'Wallet credit failed.' },
          { status: 500 }
        )
      }
    }

    // 11. Update batch items to settled
    const settledItemIds = batchItems
      .filter(item => item.status === 'pending')
      .map(item => item.pos_transaction_id)

    if (settledItemIds.length > 0) {
      await supabase
        .from('instacash_batch_items')
        .update({ status: 'settled' })
        .eq('batch_id', batch.id)
        .eq('status', 'pending')
    }

    // 12. Update razorpay_pos_transactions - mark as settled via Pulse Pay
    for (const txn of ownedTransactions) {
      const item = batchItems.find(i => i.pos_transaction_id === txn.id && (i.status === 'pending' || i.status === 'settled'))
      if (item) {
        const updatePayload: Record<string, any> = {
          wallet_credited: true,
          settlement_mode: 'INSTACASH',
          mdr_rate: item.mdr_rate,
          mdr_amount: item.mdr_amount,
          net_amount: item.net_amount,
          instacash_requested_at: new Date().toISOString(),
          instacash_batch_id: batch.id,
        }
        if (walletCreditId) updatePayload.wallet_credit_id = walletCreditId
        if (item.scheme_id) updatePayload.mdr_scheme_id = item.scheme_id
        if (item.scheme_type) updatePayload.mdr_scheme_type = item.scheme_type

        const { error: updateError, count: updateCount } = await supabase
          .from('razorpay_pos_transactions')
          .update(updatePayload, { count: 'exact' })
          .eq('id', txn.id)

        if (updateError) {
          console.error(`[PulsePay] CRITICAL: Failed to update txn ${txn.txn_id} (id=${txn.id}) status:`, updateError.message, updateError.details)
        } else {
          console.log(`[PulsePay] Txn ${txn.txn_id} (id=${txn.id}) marked as INSTACASH settled (rows updated: ${updateCount})`)
        }
      }
    }

    // 13. Finalize batch
    const finalStatus = failedCount === 0 ? 'completed' 
      : successCount === 0 ? 'failed' 
      : 'partial'

    await supabase
      .from('instacash_batches')
      .update({
        total_gross_amount: totalGrossAmount,
        total_mdr_amount: totalMdrAmount,
        total_net_amount: totalNetAmount,
        success_count: successCount,
        failed_count: failedCount,
        wallet_credit_id: walletCreditId,
        status: finalStatus,
        completed_at: new Date().toISOString(),
      })
      .eq('id', batch.id)

    console.log(`[PulsePay] Batch ${batch.id} completed: ${successCount} settled, ${failedCount} failed, net: ₹${totalNetAmount.toFixed(2)}`)

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, {
      activity_type: 'pos_instacash',
      activity_category: 'pos',
      activity_description: `Pulse Pay T+0 settlement for ${successCount} transactions`,
      reference_table: 'instacash_batches',
      reference_id: batch.id,
    }).catch(() => {})

    const failedItems = batchItems.filter(i => i.status === 'failed' || i.status === 'skipped')
    const failureReasons = Array.from(new Set(failedItems.map(i => i.error_message).filter(Boolean)))

    if (successCount === 0) {
      return NextResponse.json({
        success: false,
        batch_id: batch.id,
        error: `Pulse Pay failed for all ${failedCount} transaction(s). ${failureReasons.join('; ')}`,
        summary: {
          total_transactions: ownedTransactions.length,
          settled: 0,
          failed: failedCount,
          total_gross_amount: 0,
          total_mdr_amount: 0,
          total_net_amount: 0,
          wallet_credit_id: null,
          failure_reasons: failureReasons,
        },
      }, { status: 422 })
    }

    return NextResponse.json({
      success: true,
      batch_id: batch.id,
      summary: {
        total_transactions: ownedTransactions.length,
        settled: successCount,
        failed: failedCount,
        total_gross_amount: totalGrossAmount,
        total_mdr_amount: totalMdrAmount,
        total_net_amount: totalNetAmount,
        wallet_credit_id: walletCreditId,
        failure_reasons: failureReasons.length > 0 ? failureReasons : undefined,
      },
      message: failedCount > 0
        ? `⚡ Pulse Pay partial: ${successCount} settled, ${failedCount} failed. ₹${totalNetAmount.toFixed(2)} credited. Failed: ${failureReasons.join('; ')}`
        : `⚡ Pulse Pay complete! ${successCount} transaction(s) settled. ₹${totalNetAmount.toFixed(2)} credited to your wallet.`
    })

  } catch (error: any) {
    console.error('[PulsePay] Error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Pulse Pay processing failed.' },
      { status: 500 }
    )
  }
}

/**
 * GET - Fetch unsettled transactions or Pulse Pay batch details
 * 
 * Query params:
 *   batch_id: string  - Get specific batch details
 *   (none)           - Get all unsettled transactions for current retailer
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || !user.partner_id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized.' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const batchId = searchParams.get('batch_id')
    const checkMode = searchParams.get('check_mode')
    const supabase = getSupabaseAdmin()

    // Quick check for settlement mode (used by POSTransactionsTable)
    if (checkMode) {
      const table = user.role === 'distributor' ? 'distributors' : 'retailers'
      const { data: entity } = await supabase
        .from(table)
        .select('settlement_mode_allowed')
        .eq('partner_id', user.partner_id)
        .maybeSingle()

      return NextResponse.json({
        success: true,
        settlement_mode_allowed: entity?.settlement_mode_allowed || 'T1',
      })
    }

    if (batchId) {
      // Get batch details with items
      const { data: batch, error: batchError } = await supabase
        .from('instacash_batches')
        .select('*')
        .eq('id', batchId)
        .eq('retailer_id', user.partner_id)
        .single()

      if (batchError || !batch) {
        return NextResponse.json(
          { success: false, error: 'Batch not found.' },
          { status: 404 }
        )
      }

      const { data: items } = await supabase
        .from('instacash_batch_items')
        .select('*')
        .eq('batch_id', batchId)
        .order('created_at', { ascending: true })

      return NextResponse.json({
        success: true,
        batch,
        items: items || []
      })
    }

    // Get unsettled transactions for this retailer
    const { data: unsettled, error: unsettledError } = await supabase
      .from('razorpay_pos_transactions')
      .select('id, txn_id, amount, gross_amount, payment_mode, card_brand, card_type, card_classification, tid, device_serial, transaction_time, display_status, settlement_mode, wallet_credited, rrn, customer_name, merchant_name')
      .eq('retailer_id', user.partner_id)
      .or('display_status.ilike.SUCCESS,display_status.ilike.CAPTURED')
      .eq('wallet_credited', false)
      .is('settlement_mode', null)
      .order('transaction_time', { ascending: false })

    if (unsettledError) {
      console.error('[PulsePay] Error fetching unsettled:', unsettledError)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch unsettled transactions.' },
        { status: 500 }
      )
    }

    // Also get recent Pulse Pay batches
    const { data: recentBatches } = await supabase
      .from('instacash_batches')
      .select('*')
      .eq('retailer_id', user.partner_id)
      .order('created_at', { ascending: false })
      .limit(10)

    return NextResponse.json({
      success: true,
      unsettled: unsettled || [],
      unsettled_count: unsettled?.length || 0,
      recent_batches: recentBatches || []
    })

  } catch (error: any) {
    console.error('[PulsePay] GET Error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch data.' },
      { status: 500 }
    )
  }
}

