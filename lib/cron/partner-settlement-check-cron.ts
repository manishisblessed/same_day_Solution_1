import cron, { ScheduledTask } from 'node-cron'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { resolvePendingPartnerSettlements } from '@/lib/settlement-2/resolve-pending-partner-settlements'

// Every minute. Partner IMPS/RTGS payouts return PENDING with no UTR at transfer
// time; this sweep pulls the UTR from the provider a minute later and pushes it
// to the partner webhook — no manual "check" needed.
const CRON_EXPRESSION = '* * * * *'
const STALE_MINUTES = 1
const HARD_TIMEOUT_MINUTES = 60

const g = globalThis as any
if (!g.__partnerSettlementCheckState) {
  g.__partnerSettlementCheckState = {
    task: null as ScheduledTask | null,
    isRunning: false,
  }
}
const state = g.__partnerSettlementCheckState

async function runCheck(): Promise<void> {
  // Reentrancy guard: never let a slow provider sweep overlap the next tick.
  // Combined with the atomic PENDING claim inside the resolver, this makes a
  // double credit impossible even if a run runs long.
  if (state.isRunning) return
  state.isRunning = true

  try {
    const supabase = getSupabaseAdmin()
    const outcome = await resolvePendingPartnerSettlements(supabase, {
      staleMinutes: STALE_MINUTES,
      hardTimeoutMinutes: HARD_TIMEOUT_MINUTES,
      // Option C: never auto-refund on timeout. A still-PENDING payout is held
      // until the provider confirms a reversal or an admin refunds it manually.
      refundOnHardTimeout: false,
      limit: 50,
    })
    if (outcome.checked > 0) {
      console.log(`[Partner-Settlement-Cron] checked=${outcome.checked} resolved=${outcome.resolved} refunded=${outcome.refunded} stillPending=${outcome.stillPending} timeoutHeld=${outcome.timeoutHeld}`)
    }
  } catch (err: any) {
    console.error('[Partner-Settlement-Cron] Error:', err?.message || err)
  } finally {
    state.isRunning = false
  }
}

export async function initPartnerSettlementCheckCron(): Promise<void> {
  if (state.task) {
    state.task.stop()
    state.task = null
  }

  state.task = cron.schedule(CRON_EXPRESSION, runCheck, {
    timezone: 'Asia/Kolkata',
  })

  console.log('[Partner-Settlement-Cron] Settlement check cron started (every minute)')
}

export function stopPartnerSettlementCheckCron(): void {
  if (state.task) {
    state.task.stop()
    state.task = null
  }
}
