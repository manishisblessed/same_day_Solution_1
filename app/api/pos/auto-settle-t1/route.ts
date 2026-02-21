/**
 * Auto T+1 Settlement Cron for POS Transactions
 * 
 * POST /api/pos/auto-settle-t1
 * 
 * This endpoint is called daily (via cron/Lambda) to:
 * 1. Find all unsettled POS transactions from previous day(s)
 * 2. Calculate MDR at T+1 rates (lower than InstaCash T+0)
 * 3. Credit retailer wallets
 * 4. Mark transactions as settled via AUTO_T1
 * 
 * Security: Protected with API key (X-Api-Key or Authorization header)
 */

import { NextRequest, NextResponse } from 'next/server'
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

    // 2. Find all unsettled POS transactions older than cutoff
    const { data: unsettled, error: fetchError } = await supabase
      .from('razorpay_pos_transactions')
      .select('*')
      .eq('display_status', 'SUCCESS')
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

    // 4. Process each retailer's transactions
    for (const [retailerId, transactions] of Object.entries(retailerGroups)) {
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
          const { data: ledgerId, error: ledgerError } = await supabase.rpc('add_ledger_entry', {
            p_user_id: retailerId,
            p_user_role: 'retailer',
            p_wallet_type: 'primary',
            p_fund_category: 'online',
            p_service_type: 'pos',
            p_tx_type: 'POS_CREDIT',
            p_credit: retailerNet,
            p_debit: 0,
            p_reference_id: `AUTO-T1-${new Date().toISOString().split('T')[0]}`,
            p_transaction_id: null,
            p_status: 'completed',
            p_remarks: `T+1 Auto Settlement - ${retailerSuccessCount} txn(s), Gross: ₹${retailerGross.toFixed(2)}, MDR: ₹${retailerMdr.toFixed(2)}, Net: ₹${retailerNet.toFixed(2)}`
          })

          if (ledgerError) {
            console.error(`[AutoT1] Wallet credit error for retailer ${retailerId}:`, ledgerError)
            totalFailed += processedTxns.length
            continue
          }

          // 6. Update each transaction as settled via AUTO_T1
          for (const item of processedTxns) {
            await supabase
              .from('razorpay_pos_transactions')
              .update({
                wallet_credited: true,
                wallet_credit_id: ledgerId,
                settlement_mode: 'AUTO_T1',
                mdr_rate: item.mdrRate,
                mdr_amount: item.mdrAmount,
                net_amount: item.netAmount,
                mdr_scheme_id: item.schemeId,
                mdr_scheme_type: item.schemeType,
                auto_settled_at: new Date().toISOString(),
              })
              .eq('id', item.txn.id)
          }

          totalProcessed += retailerSuccessCount
          console.log(`[AutoT1] Retailer ${retailerId}: ${retailerSuccessCount} settled, net: ₹${retailerNet.toFixed(2)}`)

          results.push({
            retailer_id: retailerId,
            settled: retailerSuccessCount,
            gross: retailerGross,
            mdr: retailerMdr,
            net: retailerNet,
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

