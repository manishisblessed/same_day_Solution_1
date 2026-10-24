import cron, { ScheduledTask } from 'node-cron'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { resolvePendingKnteerPayouts } from '@/lib/knteer/resolve-pending'

// Every 2 minutes. Knteer IMPS payouts return PENDING when the provider
// hasn't confirmed yet. This sweep re-checks status and either resolves to
// SUCCESS (with UTR) or FAILED (with wallet refund).
const CRON_EXPRESSION = '*/2 * * * *'
const STALE_MINUTES = 2
const HARD_TIMEOUT_MINUTES = 60

const g = globalThis as any
if (!g.__knteerPendingCheckState) {
  g.__knteerPendingCheckState = {
    task: null as ScheduledTask | null,
    isRunning: false,
  }
}
const state = g.__knteerPendingCheckState

async function runCheck(): Promise<void> {
  if (state.isRunning) return
  state.isRunning = true
  try {
    const supabase = getSupabaseAdmin()
    const outcome = await resolvePendingKnteerPayouts(supabase, {
      staleMinutes: STALE_MINUTES,
      hardTimeoutMinutes: HARD_TIMEOUT_MINUTES,
      limit: 50,
    })
    if (outcome.checked > 0) {
      console.log(`[Knteer-Pending-Cron] checked=${outcome.checked} resolved=${outcome.resolved} refunded=${outcome.refunded} stillPending=${outcome.stillPending} timeoutHeld=${outcome.timeoutHeld}`)
    }
  } catch (err: any) {
    console.error('[Knteer-Pending-Cron] Error:', err?.message || err)
  } finally {
    state.isRunning = false
  }
}

export async function initKnteerPendingCheckCron(): Promise<void> {
  if (state.task) {
    state.task.stop()
    state.task = null
  }
  state.task = cron.schedule(CRON_EXPRESSION, runCheck, { timezone: 'Asia/Kolkata' })
  console.log('[Knteer-Pending-Cron] Pending-check cron started (every 2 minutes)')
}

export function stopKnteerPendingCheckCron(): void {
  if (state.task) {
    state.task.stop()
    state.task = null
  }
}
