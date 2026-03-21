import cron, { ScheduledTask } from 'node-cron'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { runSubscriptionAutoDebit } from '@/lib/subscription/run-auto-debit'

interface CronSettings {
  id: string
  schedule_hour: number
  schedule_minute: number
  timezone: string
  is_enabled: boolean
  last_run_at: string | null
  last_run_status: string | null
}

// Store cron state on globalThis to survive Next.js hot-reloads in dev
const g = globalThis as any
if (!g.__subCronState) {
  g.__subCronState = {
    currentTask: null as ScheduledTask | null,
    settingsPollingInterval: null as ReturnType<typeof setInterval> | null,
    lastCronExpression: '',
    isRunning: false,
    catchUpCheckedToday: '',
  }
}
const state = g.__subCronState

function toCronExpression(hour: number, minute: number): string {
  return `${minute} ${hour} * * *`
}

function getISTNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
}

function getISTDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function getSettings(): Promise<CronSettings | null> {
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('subscription_cron_settings')
      .select('*')
      .limit(1)
      .single()

    if (error || !data) {
      console.error('[Sub-Cron] Failed to fetch settings:', error?.message)
      return null
    }
    return data as CronSettings
  } catch (err: any) {
    console.error('[Sub-Cron] Error fetching settings:', err.message)
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
      .from('subscription_cron_settings')
      .update({
        last_run_at: new Date().toISOString(),
        last_run_status: status,
        last_run_message: message,
        last_run_processed: processed,
        last_run_failed: failed,
      })
      .not('id', 'is', null)
  } catch (err: any) {
    console.error('[Sub-Cron] Error updating run status:', err.message)
  }
}

async function runSubscriptionAutoDebitJob() {
  if (state.isRunning) {
    console.log('[Sub-Cron] Auto-debit already running, skipping...')
    return
  }

  state.isRunning = true
  console.log(`[Sub-Cron] === Subscription auto-debit started at ${new Date().toISOString()} ===`)

  let processed = 0
  let completed = 0
  let failed = 0

  try {
    const result = await runSubscriptionAutoDebit()
    processed = result.processed
    completed = result.completed
    failed = result.failed

    const status = failed === 0 ? 'success' : completed > 0 ? 'partial' : 'failed'
    const message = `Processed: ${processed}, Completed: ${completed}, Failed: ${failed}`
    await updateRunStatus(status, message, processed, failed)

    console.log(`[Sub-Cron] === Subscription auto-debit complete: ${message} ===`)
  } catch (err: any) {
    console.error('[Sub-Cron] Fatal error:', err)
    await updateRunStatus('failed', err.message || 'Unknown error', processed, failed)
  } finally {
    state.isRunning = false
  }
}

function scheduleTask(cronExpr: string, timezone: string) {
  if (state.currentTask) {
    state.currentTask.stop()
    state.currentTask = null
  }

  state.currentTask = cron.schedule(cronExpr, runSubscriptionAutoDebitJob, {
    timezone,
  })

  state.lastCronExpression = cronExpr
  console.log(`[Sub-Cron] Scheduled at cron expression: ${cronExpr} (${timezone})`)
}

async function shouldCatchUp(settings: CronSettings): Promise<boolean> {
  const istNow = getISTNow()
  const todayStr = getISTDateStr(istNow)

  if (state.catchUpCheckedToday === todayStr) return false

  const scheduledMinuteOfDay = settings.schedule_hour * 60 + settings.schedule_minute
  const currentMinuteOfDay = istNow.getHours() * 60 + istNow.getMinutes()

  if (currentMinuteOfDay <= scheduledMinuteOfDay) return false

  // Only skip catch-up if there was a SUCCESSFUL run today
  if (settings.last_run_at && settings.last_run_status === 'success') {
    const lastRunIST = new Date(new Date(settings.last_run_at).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    if (getISTDateStr(lastRunIST) === todayStr) {
      state.catchUpCheckedToday = todayStr
      return false
    }
  }

  return true
}

async function syncSchedule() {
  const settings = await getSettings()
  if (!settings) return

  if (!settings.is_enabled) {
    if (state.currentTask) {
      state.currentTask.stop()
      state.currentTask = null
      state.lastCronExpression = ''
      console.log('[Sub-Cron] Disabled by admin — cron stopped.')
    }
    return
  }

  const newCron = toCronExpression(settings.schedule_hour, settings.schedule_minute)
  if (newCron !== state.lastCronExpression) {
    scheduleTask(newCron, settings.timezone)
  }

  if (await shouldCatchUp(settings)) {
    const todayStr = getISTDateStr(getISTNow())
    state.catchUpCheckedToday = todayStr
    console.log(`[Sub-Cron] Catch-up: scheduled time ${String(settings.schedule_hour).padStart(2, '0')}:${String(settings.schedule_minute).padStart(2, '0')} already passed today and no run recorded as success. Running now...`)
    runSubscriptionAutoDebitJob()
  }
}

export async function initSubscriptionAutoDebitCron() {
  console.log('[Sub-Cron] Initializing Subscription Auto-Debit Cron...')

  // Clean up any existing polling from a previous hot-reload
  if (state.settingsPollingInterval) {
    clearInterval(state.settingsPollingInterval)
    state.settingsPollingInterval = null
  }

  await syncSchedule()

  state.settingsPollingInterval = setInterval(syncSchedule, 60_000)

  console.log('[Sub-Cron] Initialization complete. Polling for settings changes every 60s.')
}

export async function triggerManualRun(): Promise<{
  success: boolean
  message: string
  processed: number
  completed: number
  failed: number
}> {
  if (state.isRunning) {
    return {
      success: false,
      message: 'Auto-debit is already running',
      processed: 0,
      completed: 0,
      failed: 0,
    }
  }

  await runSubscriptionAutoDebitJob()

  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('subscription_cron_settings')
    .select('last_run_processed, last_run_failed, last_run_message')
    .limit(1)
    .single()

  return {
    success: true,
    message: data?.last_run_message || 'Auto-debit completed',
    processed: data?.last_run_processed || 0,
    completed: (data?.last_run_processed || 0) - (data?.last_run_failed || 0),
    failed: data?.last_run_failed || 0,
  }
}

export function getSubscriptionCronIsRunning(): boolean {
  return state.isRunning
}

export function stopSubscriptionCron() {
  if (state.currentTask) {
    state.currentTask.stop()
    state.currentTask = null
  }
  if (state.settingsPollingInterval) {
    clearInterval(state.settingsPollingInterval)
    state.settingsPollingInterval = null
  }
  state.lastCronExpression = ''
  console.log('[Sub-Cron] Stopped.')
}
