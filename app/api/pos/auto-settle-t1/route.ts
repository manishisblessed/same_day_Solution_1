/**
 * Auto T+1 Settlement Cron for POS Transactions
 * 
 * POST /api/pos/auto-settle-t1
 * 
 * This endpoint is called daily (via cron/Lambda) to:
 * 1. Find all unsettled POS transactions from previous day(s)
 * 2. Calculate MDR at T+1 rates (lower than Pulse Pay T+0)
 * 3. Credit retailer wallets
 * 4. Mark transactions as settled via AUTO_T1
 * 
 * Security: Protected with API key (X-Api-Key or Authorization header)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import {
  calculateMDR as calculateSchemeMDR,
} from '@/lib/mdr-scheme/settlement.service'
import type { SettlementType } from '@/types/mdr-scheme.types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function validateApiKey(request: NextRequest): boolean {
  const expectedApiKey = process.env.SETTLEMENT_CRON_API_KEY
  if (!expectedApiKey) {
    console.warn('[AutoT1] SETTLEMENT_CRON_API_KEY not configured')
    return false
  }

  const apiKey = 
    request.headers.get('x-api-key') || 
    request.headers.get('authorization')?.replace('Bearer ', '')

  return apiKey === expectedApiKey
}

export async function POST(request: NextRequest) {
  try {
    // 1. Validate API key
    if (!validateApiKey(request)) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const supabase = getSupabaseAdmin()
    
    // Optional: custom cutoff date (defaults to "before today")
    const body = await request.json().catch(() => ({}))
    const cutoffDate = body.before_date
      ? new Date(body.before_date)
      : new Date(new Date().setHours(0, 0, 0, 0)) // Today midnight = yesterday's transactions

    console.log(`[AutoT1] Processing unsettled POS transactions before: ${cutoffDate.toISOString()}`)

    // 2a. Get paused retailers
    const { data: pausedRows } = await supabase
      .from('retailers')
      .select('partner_id')
      .eq('t1_settlement_paused', true)
    const pausedRetailers = new Set((pausedRows || []).map((r: any) => r.partner_id))
    if (pausedRetailers.size > 0) {
      console.log(`[AutoT1] ${pausedRetailers.size} retailer(s) have T+1 paused, will be skipped.`)
    }

    // 2. Find all unsettled POS transactions older than cutoff
    const { data: unsettled, error: fetchError } = await supabase
      .from('razorpay_pos_transactions')
      .select('*')
      .or('display_status.ilike.SUCCESS,display_status.ilike.CAPTURED')
      .eq('wallet_credited', false)
      .is('settlement_mode', null)
      .not('retailer_id', 'is', null)
      .lt('transaction_time', cutoffDate.toISOString())
      .order('transaction_time', { ascending: true })
      .limit(500) // Process in batches of 500

    if (fetchError) {
      console.error('[AutoT1] Error fetching unsettled transactions:', fetchError)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch unsettled transactions.' },
        { status: 500 }
      )
    }

    if (!unsettled || unsettled.length === 0) {
      console.log('[AutoT1] No unsettled transactions found.')
      return NextResponse.json({
        success: true,
        message: 'No unsettled POS transactions found for T+1 settlement.',
        processed_count: 0,
        failed_count: 0,
      })
    }

    console.log(`[AutoT1] Found ${unsettled.length} unsettled transactions to process.`)

    // 3. Group by retailer for batch wallet credits
    const retailerGroups: Record<string, typeof unsettled> = {}
    for (const txn of unsettled) {
      const retailerId = txn.retailer_id
      if (!retailerId) continue
      if (!retailerGroups[retailerId]) retailerGroups[retailerId] = []
      retailerGroups[retailerId].push(txn)
    }

    let totalProcessed = 0
    let totalFailed = 0
    const results: any[] = []

    // 4. Process each retailer's transactions (skip paused)
    for (const [retailerId, transactions] of Object.entries(retailerGroups)) {
      if (pausedRetailers.has(retailerId)) {
        console.log(`[AutoT1] Skipping paused retailer: ${retailerId}`)
        continue
      }
      console.log(`[AutoT1] Processing ${transactions.length} transactions for retailer ${retailerId}`)

      // Get retailer hierarchy
      const { data: retailerData } = await supabase
        .from('retailers')
        .select('distributor_id, master_distributor_id')
        .eq('partner_id', retailerId)
        .maybeSingle()

      const distributorId = retailerData?.distributor_id || null

      let retailerGross = 0
      let retailerMdr = 0
      let retailerNet = 0
      let retailerSuccessCount = 0
      const processedTxns: Array<{ txn: any; mdrRate: number; mdrAmount: number; netAmount: number; schemeId: string | null; schemeType: string | null }> = []

      for (const txn of transactions) {
        const grossAmount = parseFloat(txn.gross_amount || txn.amount || '0')
        if (grossAmount <= 0) {
          totalFailed++
          continue
        }

        // Calculate MDR at T+1 rate
        const paymentMode = (txn.payment_mode || 'CARD').toUpperCase()
        const mdrResult = await calculateSchemeMDR({
          amount: grossAmount,
          settlement_type: 'T1' as SettlementType,
          mode: paymentMode.includes('UPI') ? 'UPI' as const : 'CARD' as const,
          card_type: txn.card_type?.toUpperCase() || null,
          brand_type: txn.card_brand || null,
          card_classification: txn.card_classification || null,
          retailer_id: retailerId,
          distributor_id: distributorId,
        })

        if (mdrResult.success && mdrResult.result) {
          retailerGross += grossAmount
          retailerMdr += mdrResult.result.retailer_fee
          retailerNet += mdrResult.result.retailer_settlement_amount
          retailerSuccessCount++
          processedTxns.push({
            txn,
            mdrRate: mdrResult.result.retailer_mdr,
            mdrAmount: mdrResult.result.retailer_fee,
            netAmount: mdrResult.result.retailer_settlement_amount,
            schemeId: mdrResult.result.scheme_id || null,
            schemeType: mdrResult.result.scheme_type || null,
          })
        } else {
          totalFailed++
          console.warn(`[AutoT1] MDR calc failed for txn ${txn.txn_id}: ${mdrResult.error}`)
        }
      }

      // 5. Credit wallet in one batch for this retailer
      if (retailerNet > 0 && processedTxns.length > 0) {
        try {
          // STEP 1 — Atomically CLAIM the transactions. Only rows still
          // wallet_credited=false are claimed; .select() returns exactly the
          // rows this process won. A concurrent process claims 0 rows and stops.
          const txnIds = processedTxns.map(item => item.txn.id)
          const { data: claimedRows, error: claimError } = await supabase
            .from('razorpay_pos_transactions')
            .update({ wallet_credited: true, settlement_mode: 'AUTO_T1' })
            .in('id', txnIds)
            .eq('wallet_credited', false)
            .select('id')

          if (claimError) {
            console.error(`[AutoT1] Failed to claim txns for retailer ${retailerId}:`, claimError)
            totalFailed += processedTxns.length
            continue
          }

          const claimedIds = new Set((claimedRows || []).map((r: any) => r.id))
          if (claimedIds.size === 0) {
            console.warn(`[AutoT1] Retailer ${retailerId}: all txns already claimed by another process, skipping.`)
            continue
          }

          // Credit ONLY what we actually claimed (recompute if we won a subset)
          const claimedTxns = processedTxns.filter(item => claimedIds.has(item.txn.id))
          const claimedGross = claimedTxns.reduce((s, i) => s + parseFloat(i.txn.gross_amount || i.txn.amount || '0'), 0)
          const claimedMdr = claimedTxns.reduce((s, i) => s + i.mdrAmount, 0)
          const claimedNet = claimedTxns.reduce((s, i) => s + i.netAmount, 0)

          // STEP 2 — Deterministic reference over the claimed txn IDs. The DB
          // unique index on (reference_id, retailer_id) makes a second credit
          // of the same batch physically impossible.
          const settleDate = new Date().toISOString().split('T')[0]
          const batchHash = createHash('sha256')
            .update([...claimedIds].sort().join(','))
            .digest('hex')
            .slice(0, 12)
          const referenceId = `AUTO-T1-${settleDate}-${retailerId}-${batchHash}`

          const { data: ledgerId, error: ledgerError } = await supabase.rpc('add_ledger_entry', {
            p_user_id: retailerId,
            p_user_role: 'retailer',
            p_wallet_type: 'primary',
            p_fund_category: 'online',
            p_service_type: 'pos',
            p_tx_type: 'POS_CREDIT',
            p_credit: claimedNet,
            p_debit: 0,
            p_reference_id: referenceId,
            p_transaction_id: null,
            p_status: 'completed',
            p_remarks: `T+1 Auto Settlement - ${claimedTxns.length} txn(s), Gross: ₹${claimedGross.toFixed(2)}, MDR: ₹${claimedMdr.toFixed(2)}, Net: ₹${claimedNet.toFixed(2)}`
          })

          if (ledgerError) {
            const isDuplicate = /duplicate/i.test(ledgerError.message || '')
            if (isDuplicate) {
              console.warn(`[AutoT1] Retailer ${retailerId}: batch ${referenceId} already credited, keeping marks.`)
              continue
            }
            console.error(`[AutoT1] Wallet credit error for retailer ${retailerId}:`, ledgerError)
            // Release the claim so these txns can be retried next run
            await supabase
              .from('razorpay_pos_transactions')
              .update({ wallet_credited: false, settlement_mode: null })
              .in('id', [...claimedIds])
              .is('wallet_credit_id', null)
            totalFailed += claimedTxns.length
            continue
          }

          // Update individual txn metadata (MDR details, wallet_credit_id)
          for (const item of claimedTxns) {
            await supabase
              .from('razorpay_pos_transactions')
              .update({
                wallet_credit_id: ledgerId,
                mdr_rate: item.mdrRate,
                mdr_amount: item.mdrAmount,
                net_amount: item.netAmount,
                mdr_scheme_id: item.schemeId,
                mdr_scheme_type: item.schemeType,
                auto_settled_at: new Date().toISOString(),
              })
              .eq('id', item.txn.id)
          }

          totalProcessed += claimedTxns.length
          console.log(`[AutoT1] Retailer ${retailerId}: ${claimedTxns.length} settled, net: ₹${claimedNet.toFixed(2)} (ref: ${referenceId})`)

          results.push({
            retailer_id: retailerId,
            settled: claimedTxns.length,
            gross: claimedGross,
            mdr: claimedMdr,
            net: claimedNet,
            wallet_credit_id: ledgerId,
          })
        } catch (err: any) {
          console.error(`[AutoT1] Error processing retailer ${retailerId}:`, err)
          totalFailed += processedTxns.length
        }
      }
    }

    console.log(`[AutoT1] Complete: ${totalProcessed} settled, ${totalFailed} failed`)

    return NextResponse.json({
      success: true,
      message: `T+1 auto-settlement complete. ${totalProcessed} transactions settled, ${totalFailed} failed.`,
      processed_count: totalProcessed,
      failed_count: totalFailed,
      cutoff_date: cutoffDate.toISOString(),
      retailers_processed: results.length,
      results,
    })

  } catch (error: any) {
    console.error('[AutoT1] Error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'T+1 settlement failed.' },
      { status: 500 }
    )
  }
}

/**
 * GET - Status endpoint
 */
export async function GET() {
  return NextResponse.json({
    message: 'POS T+1 Auto-Settlement Cron Endpoint',
    status: 'active',
    description: 'Processes unsettled POS transactions at T+1 MDR rates. Call via POST with X-Api-Key header.',
  })
}

