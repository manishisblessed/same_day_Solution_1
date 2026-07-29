import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkTransactionStatus } from '@/services/shadval-pay'
import { sendSettlementCallback } from '@/lib/settlement-callback'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { refundShadvalSettlement } from '@/lib/settlement-2/shadval-refund'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const STALE_MINUTES = 5
const HARD_TIMEOUT_MINUTES = 60

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

/**
 * POST /api/partner/settlement/check-pending
 *
 * Resolves stuck PENDING settlement transactions:
 * - With reference_id: queries Shadval Pay status API
 * - Older than HARD_TIMEOUT_MINUTES without resolution: auto-fails + refunds
 * - Fires partner callback on status change
 *
 * Auth: x-cron-secret header for cron, or admin session
 */
export async function POST(request: NextRequest) {
  try {
    const cronSecret = request.headers.get('x-cron-secret')
    const isAuthorizedCron = !!(cronSecret && cronSecret === process.env.CRON_SECRET)

    if (!isAuthorizedCron) {
      const { user } = await getCurrentUserWithFallback(request)
      if (!user || !['admin', 'finance_executive'].includes(user.role as string)) {
        return NextResponse.json(
          { success: false, error: 'Admin or cron authentication required' },
          { status: 401 }
        )
      }
    }

    const supabase = getSupabase()

    const staleThreshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString()
    const hardTimeoutThreshold = new Date(Date.now() - HARD_TIMEOUT_MINUTES * 60 * 1000).toISOString()

    const { data: pendingTxs, error: fetchErr } = await supabase
      .from('shadval_settlement')
      .select('id, retailer_id, reference_id, order_id, amount, charges, total_debit, actual_wallet_debit, mode, status, account_number, ifsc_code, account_holder_name, status_message, provider_timestamp, utr, created_at')
      .eq('status', 'PENDING')
      .lt('created_at', staleThreshold)
      .order('created_at', { ascending: true })
      .limit(50)

    if (fetchErr) {
      console.error('[Settlement Check-Pending] Fetch error:', fetchErr)
      return NextResponse.json({ success: false, error: 'Failed to fetch pending transactions' }, { status: 500 })
    }

    if (!pendingTxs || pendingTxs.length === 0) {
      return NextResponse.json({ success: true, message: 'No pending settlement transactions', checked: 0, resolved: 0, refunded: 0 })
    }

    console.log(`[Settlement Check-Pending] Found ${pendingTxs.length} stale transactions`)

    let checked = 0
    let resolved = 0
    let refunded = 0
    let stillPending = 0
    const results: Array<{ id: string; ref: string; previous_status: string; new_status: string; action: string }> = []

    for (const tx of pendingTxs) {
      checked++

      // Try checking status with provider if we have a reference_id
      if (tx.reference_id) {
        try {
          const statusResult = await checkTransactionStatus({ reference_id: tx.reference_id })

          if (statusResult.status === 'SUCCESS' && statusResult.data) {
            const txnStatus = statusResult.data.txn_status?.toLowerCase() || ''
            const isSuccess = txnStatus.includes('success')
            const isFailed = txnStatus.includes('fail') || txnStatus.includes('reversed')

            if (isSuccess || isFailed) {
              const newStatus = isSuccess ? 'SUCCESS' : 'FAILED'

              // Atomically claim the transition
              const { data: claimed } = await supabase
                .from('shadval_settlement')
                .update({
                  status: newStatus,
                  utr: statusResult.data.utr || tx.utr || null,
                  order_id: statusResult.data.order_id || tx.order_id || null,
                  internal_ref_id: statusResult.data.internal_ref_id || null,
                  status_message: statusResult.data.status_message || statusResult.data.txn_status || null,
                  provider_timestamp: statusResult.data.timestamp || null,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', tx.id)
                .eq('status', 'PENDING')
                .select('id')

              if (!claimed || claimed.length === 0) {
                results.push({ id: tx.id, ref: tx.reference_id, previous_status: 'PENDING', new_status: 'PENDING', action: 'already_claimed' })
                continue
              }

              if (isFailed) {
                // Route to the correct wallet (partner vs retailer) via the shared
                // exactly-once refund helper.
                const refund = await refundShadvalSettlement(supabase, tx, { note: 'check-pending auto' })
                if (refund.critical) {
                  console.error(`[Settlement Check-Pending] CRITICAL refund failed for ${tx.id}:`, refund.error)
                  await supabase
                    .from('shadval_settlement')
                    .update({
                      status_message: `${statusResult.data.status_message || statusResult.data.txn_status || 'FAILED'} [CRITICAL: REFUND_FAILED - Manual review required] (${refund.error})`,
                    })
                    .eq('id', tx.id)
                } else if (!refund.alreadyRefunded) {
                  refunded++
                }
              }

              // Send callback to partner
              const updatedTx = {
                ...tx,
                status: newStatus,
                utr: statusResult.data.utr || tx.utr,
                order_id: statusResult.data.order_id || tx.order_id,
                status_message: statusResult.data.status_message || statusResult.data.txn_status,
                provider_timestamp: statusResult.data.timestamp,
              }
              sendSettlementCallback(tx.retailer_id, updatedTx).catch(() => {})

              resolved++
              results.push({ id: tx.id, ref: tx.reference_id, previous_status: 'PENDING', new_status: newStatus, action: isFailed ? 'resolved_failed_refunded' : 'resolved_success' })
              continue
            }
          }
        } catch (err: any) {
          console.error(`[Settlement Check-Pending] Status check error for ${tx.id}:`, err)
        }
      }

      // Hard timeout: force-fail transactions older than HARD_TIMEOUT_MINUTES
      if (tx.created_at < hardTimeoutThreshold) {
        const txAgeMin = Math.round((Date.now() - new Date(tx.created_at).getTime()) / 60000)

        const { data: claimed } = await supabase
          .from('shadval_settlement')
          .update({
            status: 'FAILED',
            status_message: `Auto-failed: No resolution after ${txAgeMin} minutes`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', tx.id)
          .eq('status', 'PENDING')
          .select('id')

        if (claimed && claimed.length > 0) {
          // Unified reference (REFUND_<ref>) — NOT REFUND_TIMEOUT_ — so this can
          // never double-credit on top of a status-poll/verify refund. The helper
          // also treats any legacy REFUND_TIMEOUT_ entry as already refunded.
          const refund = await refundShadvalSettlement(supabase, tx, { note: `timeout ${txAgeMin}min` })
          if (refund.critical) {
            console.error(`[Settlement Check-Pending] CRITICAL timeout refund failed for ${tx.id}:`, refund.error)
            await supabase
              .from('shadval_settlement')
              .update({
                status_message: `Auto-failed: No resolution after ${txAgeMin} minutes [CRITICAL: REFUND_FAILED - Manual review required] (${refund.error})`,
              })
              .eq('id', tx.id)
          } else if (!refund.alreadyRefunded) {
            refunded++
          }

          const failedTx = { ...tx, status: 'FAILED', status_message: `Auto-failed after ${txAgeMin} minutes` }
          sendSettlementCallback(tx.retailer_id, failedTx).catch(() => {})

          results.push({ id: tx.id, ref: tx.reference_id, previous_status: 'PENDING', new_status: 'FAILED', action: `timeout_refunded_${txAgeMin}min` })
        }
        continue
      }

      stillPending++
      results.push({ id: tx.id, ref: tx.reference_id, previous_status: 'PENDING', new_status: 'PENDING', action: 'still_pending' })
    }

    console.log(`[Settlement Check-Pending] Done: checked=${checked} resolved=${resolved} refunded=${refunded} stillPending=${stillPending}`)

    return NextResponse.json({
      success: true,
      checked,
      resolved,
      refunded,
      still_pending: stillPending,
      results: isAuthorizedCron ? results : undefined,
    })
  } catch (error: any) {
    console.error('[Settlement Check-Pending] Error:', error)
    return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 })
  }
}
