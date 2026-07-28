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
import { runPosT1Settlement } from '@/lib/settlement/pos-t1-core'

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

    // Optional: custom cutoff date (defaults to "before today")
    const body = await request.json().catch(() => ({}))
    const cutoffDate = body.before_date
      ? new Date(body.before_date)
      : new Date(new Date().setHours(0, 0, 0, 0)) // Today midnight = yesterday's transactions

    console.log(`[AutoT1] Processing unsettled POS transactions before: ${cutoffDate.toISOString()}`)

    // Per-transaction settlement + distributor commission, drained to completion.
    const settlement = await runPosT1Settlement({ beforeDate: cutoffDate })

    console.log(
      `[AutoT1] Complete: ${settlement.processed} settled, ${settlement.commissionCredited} commissions, ` +
      `${settlement.excludedPreStart} pre-start excluded, ${settlement.failed} failed`
    )

    return NextResponse.json({
      success: true,
      message: `T+1 auto-settlement complete. ${settlement.processed} transactions settled, ${settlement.failed} failed.`,
      processed_count: settlement.processed,
      failed_count: settlement.failed,
      commission_credited_count: settlement.commissionCredited,
      excluded_pre_start_count: settlement.excludedPreStart,
      cutoff_date: cutoffDate.toISOString(),
      retailers_processed: settlement.retailersProcessed,
      results: settlement.results,
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

