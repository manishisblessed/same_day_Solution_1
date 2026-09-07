let intervalHandle: ReturnType<typeof setInterval> | null = null
let isRunning = false

async function runReconcile() {
  if (isRunning) {
    console.log('[PinelabReconCron] Skip: already running')
    return
  }

  isRunning = true
  const startMs = Date.now()

  try {
    const { runPinelabReconcile } = await import('@/lib/pinelab/reconcile')
    const data = await runPinelabReconcile()

    const elapsed = Date.now() - startMs
    const summary = data.results
      .map(r =>
        `${r.merchant}: checked=${r.checked} failed+${r.flippedFailed} rev+${r.flippedReversed} verified=${r.verifiedSettled}` +
        `${r.unsettledOld ? ` unsettledOld=${r.unsettledOld}` : ''}` +
        `${r.clawbackNeeded ? ` CLAWBACK=${r.clawbackNeeded}` : ''}` +
        `${r.errors.length ? ` ERR=${r.errors.length}` : ''}`
      )
      .join(' | ')
    console.log(`[PinelabReconCron] ${summary} (${elapsed}ms)`)

    for (const r of data.results) {
      if (r.errors.length > 0) {
        console.error(`[PinelabReconCron] ${r.merchant} errors:`, r.errors.slice(0, 3))
      }
    }
  } catch (err: any) {
    console.error(`[PinelabReconCron] Reconcile error: ${err.message}`)
  } finally {
    isRunning = false
  }
}

export async function initPinelabReconcileCron() {
  const config = process.env.PINELAB_MERCHANTS_CONFIG
  if (!config) {
    console.log('[PinelabReconCron] PINELAB_MERCHANTS_CONFIG not set, skipping init.')
    return
  }

  // Runs less often than the sync — status flips are not second-by-second.
  const intervalMin = parseInt(process.env.PINELAB_RECON_INTERVAL_MINUTES || '60', 10)
  const intervalMs = intervalMin * 60 * 1000

  const safeRun = () => {
    runReconcile().catch(err => console.error('[PinelabReconCron] Unhandled:', err))
  }

  intervalHandle = setInterval(safeRun, intervalMs)
  console.log(`[PinelabReconCron] Scheduled every ${intervalMin}m`)

  // Stagger the first run after sync so both aren't hammering the API at boot.
  setTimeout(safeRun, 120000)
}

export function stopPinelabReconcileCron() {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
  console.log('[PinelabReconCron] Stopped.')
}
