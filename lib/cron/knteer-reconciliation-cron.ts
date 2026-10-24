import cron, { ScheduledTask } from 'node-cron'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { checkKnteerStatus } from '@/services/knteer-payout'

/**
 * Knteer Payout — Daily Reconciliation Cron
 *
 * Runs at 01:30 IST every day. Re-verifies every FAILED+refunded Knteer payout
 * transaction from the past 7 days against the provider. If a transaction we
 * refunded is actually confirmed SUCCESS at Knteer (double-money scenario),
 * it is flagged with a CRITICAL log for admin review.
 *
 * Mirrors shadval-reconciliation-cron.ts.
 */

const CRON_EXPRESSION = '30 1 * * *'   // 01:30 IST daily
const LOOKBACK_DAYS = 7
const LIMIT = 500

const g = globalThis as any
if (!g.__knteerReconState) {
  g.__knteerReconState = {
    task: null as ScheduledTask | null,
    isRunning: false,
  }
}
const state = g.__knteerReconState

async function runReconcile(): Promise<void> {
  if (state.isRunning) return
  state.isRunning = true
  let checked = 0, doubleMoney = 0, totalLoss = 0

  try {
    const supabase = getSupabaseAdmin()
    const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

    // Fetch FAILED transactions that were refunded to our users in the window
    const { data: rows, error } = await supabase
      .from('knteer_payout_transactions')
      .select('id, partner_trans_id, amount, retailer_id, user_role, status_message')
      .eq('status', 'FAILED')
      .gte('created_at', cutoff)
      .limit(LIMIT)

    if (error) throw new Error(`Knteer recon fetch failed: ${error.message}`)
    if (!rows || rows.length === 0) {
      console.log('[Knteer-Recon-Cron] No FAILED transactions to check')
      return
    }

    for (const row of rows) {
      if (!row.partner_trans_id) continue
      checked++

      try {
        const result = await checkKnteerStatus(row.partner_trans_id)

        // If provider says SUCCESS with UTR → we refunded AND payout went through = double money
        if (result.success && result.status === 'success' && result.utr) {
          doubleMoney++
          totalLoss += parseFloat(String(row.amount || 0))

          console.error(
            `[Knteer-Recon-Cron] ⚠️ DOUBLE-MONEY DETECTED: txId=${row.id} ` +
            `partnerTransId=${row.partner_trans_id} amount=₹${row.amount} ` +
            `utr=${result.utr} retailer=${row.retailer_id}`
          )

          // Mark in DB for admin review
          await supabase
            .from('knteer_payout_transactions')
            .update({
              status_message: `[RECON-ALERT] Provider confirms SUCCESS UTR=${result.utr} but we marked FAILED and refunded. MANUAL REVIEW REQUIRED.`,
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id)
        }
      } catch (e: any) {
        // Provider unreachable — skip, will retry next day
        console.warn(`[Knteer-Recon-Cron] Status check failed for ${row.partner_trans_id}:`, e?.message)
      }

      // Small delay to avoid hammering Knteer API
      await new Promise(r => setTimeout(r, 200))
    }

    console.log(
      `[Knteer-Recon-Cron] Done: checked=${checked} doubleMoney=${doubleMoney} potentialLoss=₹${totalLoss.toFixed(2)}`
    )
    if (doubleMoney > 0) {
      console.error(`[Knteer-Recon-Cron] 🚨 ALERT: ${doubleMoney} double-money transactions detected. Total potential loss: ₹${totalLoss.toFixed(2)}. Check DB for [RECON-ALERT] status messages.`)
    }
  } catch (err: any) {
    console.error('[Knteer-Recon-Cron] Error:', err?.message || err)
  } finally {
    state.isRunning = false
  }
}

export async function initKnteerReconciliationCron(): Promise<void> {
  if (state.task) {
    state.task.stop()
    state.task = null
  }
  state.task = cron.schedule(CRON_EXPRESSION, runReconcile, { timezone: 'Asia/Kolkata' })
  console.log('[Knteer-Recon-Cron] Daily reconciliation cron started (01:30 IST)')
}

export function stopKnteerReconciliationCron(): void {
  if (state.task) {
    state.task.stop()
    state.task = null
  }
}
