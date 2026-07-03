import cron, { ScheduledTask } from 'node-cron'

let task: ScheduledTask | null = null
let isRunning = false

async function runSync() {
  if (isRunning) {
    console.log('[PinelabCron] Sync already running, skipping...')
    return
  }

  isRunning = true
  const startedAt = new Date().toISOString()
  console.log(`[PinelabCron] === Sync started at ${startedAt} ===`)

  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const cronSecret = process.env.CRON_SECRET || ''

    const res = await fetch(`${baseUrl}/api/pinelab/sync-transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': cronSecret,
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(120000),
    })

    if (!res.ok) {
      console.error(`[PinelabCron] Sync API returned ${res.status}`)
      return
    }

    const data = await res.json()
    console.log(`[PinelabCron] === Sync complete ===`, JSON.stringify(data.results?.map((r: any) => ({
      merchant: r.merchant,
      fetched: r.fetched,
      created: r.created,
      updated: r.updated,
      errors: r.errors?.length || 0,
    }))))
  } catch (err: any) {
    console.error('[PinelabCron] Sync error:', err.message)
  } finally {
    isRunning = false
  }
}

export async function initPinelabSyncCron() {
  const config = process.env.PINELAB_MERCHANTS_CONFIG
  if (!config) {
    console.log('[PinelabCron] PINELAB_MERCHANTS_CONFIG not set, skipping cron init.')
    return
  }

  // Run every 10 minutes
  const schedule = process.env.PINELAB_SYNC_SCHEDULE || '*/10 * * * *'

  task = cron.schedule(schedule, runSync, {
    timezone: 'Asia/Kolkata',
  })

  console.log(`[PinelabCron] Scheduled at: ${schedule} (Asia/Kolkata)`)

  // Run once on startup after a short delay
  setTimeout(runSync, 15000)
}

export function stopPinelabSyncCron() {
  if (task) {
    task.stop()
    task = null
  }
  console.log('[PinelabCron] Stopped.')
}
