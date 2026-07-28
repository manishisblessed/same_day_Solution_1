import cron, { ScheduledTask } from 'node-cron'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

interface CronSettings {
  id: string
  schedule_hour: number
  schedule_minute: number
  timezone: string
  is_enabled: boolean
}

let currentTask: ScheduledTask | null = null
let settingsPollingInterval: ReturnType<typeof setInterval> | null = null
let lastCronExpression = ''
let isRunning = false

function toCronExpression(hour: number, minute: number): string {
  return `${minute} ${hour} * * *`
}

async function getSettings(): Promise<CronSettings | null> {
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('t1_cron_settings')
      .select('*')
      .limit(1)
      .single()

    if (error || !data) {
      console.error('[T1-Cron] Failed to fetch settings:', error?.message)
      return null
    }
    return data as CronSettings
  } catch (err: any) {
    console.error('[T1-Cron] Error fetching settings:', err.message)
    return null
  }
}

async function updateRunStatus(
  status: 'success' | 'partial' | 'failed',
  message: string,
  processed: number,
  failed: number
) {
  try {
    const supabase = getSupabaseAdmin()
    await supabase
      .from('t1_cron_settings')
      .update({
        last_run_at: new Date().toISOString(),
        last_run_status: status,
        last_run_message: message,
        last_run_processed: processed,
        last_run_failed: failed,
      })
      .not('id', 'is', null)
  } catch (err: any) {
    console.error('[T1-Cron] Error updating run status:', err.message)
  }
}

async function getPausedRetailerIds(): Promise<Set<string>> {
  try {
    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('retailers')
      .select('partner_id')
      .eq('t1_settlement_paused', true)
    return new Set((data || []).map((r: any) => r.partner_id))
  } catch {
    return new Set()
  }
}

async function runT1Settlement() {
  if (isRunning) {
    console.log('[T1-Cron] Settlement already running, skipping...')
    return
  }

  isRunning = true
  console.log(`[T1-Cron] === T+1 Settlement started at ${new Date().toISOString()} ===`)

  let totalProcessed = 0
  let totalFailed = 0

  try {
    const supabase = getSupabaseAdmin()
    const pausedRetailers = await getPausedRetailerIds()

    if (pausedRetailers.size > 0) {
      console.log(`[T1-Cron] ${pausedRetailers.size} retailer(s) paused, will be skipped.`)
    }

    const cutoffDate = new Date(new Date().setHours(0, 0, 0, 0))

    // --- Part 1: POS Auto-Settle T+1 (shared core with /api/pos/auto-settle-t1) ---
    // Per-transaction settlement + distributor commission, drained to completion.
    const { runPosT1Settlement } = await import('@/lib/settlement/pos-t1-core')
    const posResult = await runPosT1Settlement({ beforeDate: cutoffDate, pausedRetailers })
    totalProcessed += posResult.processed
    totalFailed += posResult.failed
    console.log(
      `[T1-Cron] POS: ${posResult.processed} settled, ${posResult.commissionCredited} commissions, ` +
      `${posResult.excludedPreStart} pre-start excluded, ${posResult.failed} failed`
    )

    // --- Part 2: MDR Scheme T+1 (same logic as /api/settlement/run-t1) ---
    const { getPendingT1Transactions, processSettlement } = await import(
      '@/lib/mdr-scheme/settlement.service'
    )

    const beforeDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const pendingTransactions = await getPendingT1Transactions(beforeDate)

    if (pendingTransactions.length > 0) {
      console.log(`[T1-Cron] Found ${pendingTransactions.length} pending MDR T+1 transactions`)

      for (const transaction of pendingTransactions) {
        if (pausedRetailers.has(transaction.retailer_id)) {
          console.log(`[T1-Cron] Skipping paused retailer: ${transaction.retailer_id}`)
          continue
        }

        try {
          const result = await processSettlement(transaction)
          if (result.success) {
            totalProcessed++
            console.log(`[T1-Cron] MDR: Processed ${transaction.razorpay_payment_id}`)
          } else {
            totalFailed++
            console.error(`[T1-Cron] MDR: Failed ${transaction.razorpay_payment_id}: ${result.error}`)
          }
        } catch (err: any) {
          totalFailed++
          console.error(`[T1-Cron] MDR: Error ${transaction.razorpay_payment_id}: ${err.message}`)
        }
      }
    } else {
      console.log('[T1-Cron] No pending MDR T+1 transactions found.')
    }

    // --- Part 3: Partner T+1 settlement (opt-in — partners are paused by default) ---
    try {
      const { runPartnerT1Settlement } = await import('@/lib/cron/t1-settlement-cron-partners')
      const partnerResult = await runPartnerT1Settlement()
      totalProcessed += partnerResult.processed
      totalFailed += partnerResult.failed
    } catch (err: any) {
      console.error('[T1-Cron] Partner settlement pass failed:', err)
    }

    const status = totalFailed === 0 ? 'success' : totalProcessed > 0 ? 'partial' : 'failed'
    const message = `Processed: ${totalProcessed}, Failed: ${totalFailed}`
    await updateRunStatus(status, message, totalProcessed, totalFailed)

    console.log(`[T1-Cron] === T+1 Settlement complete: ${message} ===`)
  } catch (err: any) {
    console.error('[T1-Cron] Fatal error during settlement:', err)
    await updateRunStatus('failed', err.message || 'Unknown error', totalProcessed, totalFailed)
  } finally {
    isRunning = false
  }
}

function scheduleTask(cronExpr: string, timezone: string) {
  if (currentTask) {
    currentTask.stop()
    currentTask = null
  }

  currentTask = cron.schedule(cronExpr, runT1Settlement, {
    timezone,
  })

  lastCronExpression = cronExpr
  console.log(`[T1-Cron] Scheduled at cron expression: ${cronExpr} (${timezone})`)
}

async function syncSchedule() {
  const settings = await getSettings()
  if (!settings) return

  if (!settings.is_enabled) {
    if (currentTask) {
      currentTask.stop()
      currentTask = null
      lastCronExpression = ''
      console.log('[T1-Cron] Disabled by admin — cron stopped.')
    }
    return
  }

  const newCron = toCronExpression(settings.schedule_hour, settings.schedule_minute)
  if (newCron !== lastCronExpression) {
    scheduleTask(newCron, settings.timezone)
  }
}

export async function initT1SettlementCron() {
  console.log('[T1-Cron] Initializing T+1 Settlement Cron...')

  await syncSchedule()

  // Poll for settings changes every 60 seconds
  settingsPollingInterval = setInterval(syncSchedule, 60_000)

  console.log('[T1-Cron] Initialization complete. Polling for settings changes every 60s.')
}

export async function triggerManualRun(): Promise<{
  success: boolean
  message: string
  processed: number
  failed: number
}> {
  if (isRunning) {
    return { success: false, message: 'Settlement is already running', processed: 0, failed: 0 }
  }

  await runT1Settlement()

  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('t1_cron_settings')
    .select('last_run_processed, last_run_failed, last_run_message')
    .limit(1)
    .single()

  return {
    success: true,
    message: data?.last_run_message || 'Settlement completed',
    processed: data?.last_run_processed || 0,
    failed: data?.last_run_failed || 0,
  }
}

export function getIsRunning(): boolean {
  return isRunning
}

export function stopCron() {
  if (currentTask) {
    currentTask.stop()
    currentTask = null
  }
  if (settingsPollingInterval) {
    clearInterval(settingsPollingInterval)
    settingsPollingInterval = null
  }
  lastCronExpression = ''
  console.log('[T1-Cron] Stopped.')
}
