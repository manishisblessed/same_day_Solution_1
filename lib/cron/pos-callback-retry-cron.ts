let intervalHandle: ReturnType<typeof setInterval> | null = null
let isRunning = false

async function runRetry() {
  if (isRunning) {
    console.log('[PosCallbackRetryCron] Skip: already running')
    return
  }

  isRunning = true
  const startMs = Date.now()

  try {
    const { retryFailedPosCallbacks } = await import('@/lib/partner-webhook/retry')
    const res = await retryFailedPosCallbacks()
    const elapsed = Date.now() - startMs
    if (res.targets > 0 || res.errors.length > 0) {
      console.log(
        `[PosCallbackRetryCron] targets=${res.targets} retried=${res.retried} ok=${res.succeeded}` +
          `${res.errors.length ? ` ERR=${res.errors.length}` : ''} (${elapsed}ms)`
      )
      if (res.errors.length) console.error('[PosCallbackRetryCron] errors:', res.errors.slice(0, 3))
    }
  } catch (err: any) {
    console.error(`[PosCallbackRetryCron] Error: ${err?.message || err}`)
  } finally {
    isRunning = false
  }
}

export async function initPosCallbackRetryCron() {
  const intervalSec = parseInt(process.env.POS_CALLBACK_RETRY_INTERVAL_SECONDS || '300', 10)
  const intervalMs = intervalSec * 1000

  const safeRun = () => {
    runRetry().catch((err) => console.error('[PosCallbackRetryCron] Unhandled:', err))
  }

  intervalHandle = setInterval(safeRun, intervalMs)
  console.log(`[PosCallbackRetryCron] Scheduled every ${intervalSec}s`)

  // Delay first run to let Next.js finish initial compilation.
  setTimeout(safeRun, 45000)
}

export function stopPosCallbackRetryCron() {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
  console.log('[PosCallbackRetryCron] Stopped.')
}
