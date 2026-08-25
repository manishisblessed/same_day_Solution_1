import cron, { ScheduledTask } from 'node-cron'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { runShadvalReconciliation } from '@/lib/settlement-2/reconcile-shadval-report'

// Once a day at 01:15 IST. Re-verifies every FAILED+refunded Settlement-2
// transaction against the provider so any that later settled at the bank
// (double-money loss) is caught and an admin alert is raised.
const CRON_EXPRESSION = '15 1 * * *'
const LOOKBACK_DAYS = 7
const LIMIT = 500

const g = globalThis as any
if (!g.__shadvalReconcileState) {
  g.__shadvalReconcileState = {
    task: null as ScheduledTask | null,
    isRunning: false,
  }
}
const state = g.__shadvalReconcileState

async function runReconcile(): Promise<void> {
  if (state.isRunning) return
  state.isRunning = true
  try {
    const supabase = getSupabaseAdmin()
    const outcome = await runShadvalReconciliation(supabase, {
      days: LOOKBACK_DAYS,
      limit: LIMIT,
      concurrency: 5,
      raiseAlerts: true,
    })
    console.log(
      `[Shadval-Reconcile-Cron] checked=${outcome.checked} doubleMoney=${outcome.doubleMoney.length} loss=₹${outcome.totalLoss.toFixed(2)} refundOk=${outcome.refundOk} unverified=${outcome.unverified}`
    )
    if (outcome.doubleMoney.length > 0) {
      console.warn(
        `[Shadval-Reconcile-Cron] CONFIRMED double-money refs: ${outcome.doubleMoney.map((h) => h.reference_id).join(', ')}`
      )
    }
  } catch (err: any) {
    console.error('[Shadval-Reconcile-Cron] Error:', err?.message || err)
  } finally {
    state.isRunning = false
  }
}

export async function initShadvalReconciliationCron(): Promise<void> {
  if (state.task) {
    state.task.stop()
    state.task = null
  }

  state.task = cron.schedule(CRON_EXPRESSION, runReconcile, {
    timezone: 'Asia/Kolkata',
  })

  console.log('[Shadval-Reconcile-Cron] Daily reconciliation cron started (01:15 IST)')
}

export function stopShadvalReconciliationCron(): void {
  if (state.task) {
    state.task.stop()
    state.task = null
  }
}
