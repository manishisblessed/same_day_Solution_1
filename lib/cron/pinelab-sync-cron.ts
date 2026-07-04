let intervalHandle: ReturnType<typeof setInterval> | null = null
let isRunning = false

async function runSync() {
  if (isRunning) {
    console.log('[PinelabCron] Skip: already running')
    return
  }

  isRunning = true
  const startMs = Date.now()

  try {
    const { runPinelabSync } = await import('@/lib/pinelab/sync')
    const data = await runPinelabSync()

    const elapsed = Date.now() - startMs
    const summary = data.results
      .map(r => `${r.merchant}: fetched=${r.fetched} +${r.created} new ${r.updated} upd${r.errors.length ? ` ERR=${r.errors.length}` : ''}`)
      .join(' | ')
    console.log(`[PinelabCron] ${summary} (${elapsed}ms)`)

    for (const r of data.results) {
      if (r.errors.length > 0) {
        console.error(`[PinelabCron] ${r.merchant} errors:`, r.errors.slice(0, 2))
      }
    }
  } catch (err: any) {
    console.error(`[PinelabCron] Sync error: ${err.message}`)
  } finally {
    isRunning = false
  }
}

export async function initPinelabSyncCron() {
  const config = process.env.PINELAB_MERCHANTS_CONFIG
  if (!config) {
    console.log('[PinelabCron] PINELAB_MERCHANTS_CONFIG not set, skipping init.')
    return
  }

  const intervalSec = parseInt(process.env.PINELAB_SYNC_INTERVAL_SECONDS || '600', 10)
  const intervalMs = intervalSec * 1000

  // Wrap runSync so unhandled rejections don't kill the interval
  const safeRun = () => {
    runSync().catch(err => console.error('[PinelabCron] Unhandled:', err))
  }

  intervalHandle = setInterval(safeRun, intervalMs)

  console.log(`[PinelabCron] Scheduled every ${intervalSec}s`)

  // Delay first run to let Next.js finish initial compilations
  setTimeout(safeRun, 30000)
}

export function stopPinelabSyncCron() {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
  console.log('[PinelabCron] Stopped.')
}
