/**
 * Pine Labs FAST reversal reconcile (Phase 2).
 *
 * The main reconcile cron (`pinelab-reconcile-cron`) runs every ~60 min over a
 * 21-day window — fine for settlement verification, too slow for catching a
 * fresh capture that auto-reverses minutes after we forwarded SUCCESS to a
 * partner. For instant-settling partners (e.g. ECAPS) that lag is money lost.
 *
 * This job re-runs the SAME reconcile logic over a TIGHT recent window
 * (default: last 24h) on a SHORT interval (default: every 5 min), so a
 * capture→FAILED/VOID/REFUND flip propagates a `pos.transaction.reversed`
 * webhook to the partner within minutes — while the funds are most likely still
 * in their end-user's wallet and can be clawed back cleanly.
 *
 * It shares `runPinelabReconcile` (with an explicit window), so it never moves
 * money and behaves identically to the full recon, just faster and narrower.
 */
let intervalHandle: ReturnType<typeof setInterval> | null = null
let isRunning = false

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const toIstString = (d: Date) =>
  new Date(d.getTime() + IST_OFFSET_MS).toISOString().replace('Z', '').split('.')[0]

async function runFastRecon() {
  if (isRunning) {
    console.log('[PinelabFastRecon] Skip: already running')
    return
  }

  isRunning = true
  const startMs = Date.now()

  try {
    const windowHours = parseInt(process.env.PINELAB_FAST_RECON_WINDOW_HOURS || '24', 10)
    const now = new Date()
    const fromDate = toIstString(new Date(now.getTime() - windowHours * 60 * 60 * 1000))
    const toDate = toIstString(new Date(now.getTime() + 6 * 60 * 60 * 1000))

    const { runPinelabReconcile } = await import('@/lib/pinelab/reconcile')
    const data = await runPinelabReconcile({ fromDate, toDate })

    const elapsed = Date.now() - startMs
    const summary = data.results
      .map(r =>
        `${r.merchant}: checked=${r.checked} failed+${r.flippedFailed} rev+${r.flippedReversed}` +
        `${r.webhooksEmitted ? ` cb=${r.webhooksEmitted}` : ''}` +
        `${r.clawbackNeeded ? ` CLAWBACK=${r.clawbackNeeded}` : ''}` +
        `${r.errors.length ? ` ERR=${r.errors.length}` : ''}`
      )
      .join(' | ')
    console.log(`[PinelabFastRecon] (${windowHours}h) ${summary} (${elapsed}ms)`)

    for (const r of data.results) {
      if (r.errors.length > 0) {
        console.error(`[PinelabFastRecon] ${r.merchant} errors:`, r.errors.slice(0, 3))
      }
    }
  } catch (err: any) {
    console.error(`[PinelabFastRecon] Fast reconcile error: ${err.message}`)
  } finally {
    isRunning = false
  }
}

export async function initPinelabFastReconCron() {
  const config = process.env.PINELAB_MERCHANTS_CONFIG
  if (!config) {
    console.log('[PinelabFastRecon] PINELAB_MERCHANTS_CONFIG not set, skipping init.')
    return
  }
  if (process.env.PINELAB_FAST_RECON_ENABLED === 'false') {
    console.log('[PinelabFastRecon] Disabled via PINELAB_FAST_RECON_ENABLED=false.')
    return
  }

  const intervalSec = parseInt(process.env.PINELAB_FAST_RECON_INTERVAL_SECONDS || '300', 10)
  const intervalMs = intervalSec * 1000

  const safeRun = () => {
    runFastRecon().catch(err => console.error('[PinelabFastRecon] Unhandled:', err))
  }

  intervalHandle = setInterval(safeRun, intervalMs)
  console.log(`[PinelabFastRecon] Scheduled every ${intervalSec}s (window ${process.env.PINELAB_FAST_RECON_WINDOW_HOURS || '24'}h)`)

  // Stagger the first run so boot isn't hammering the Pine Labs API alongside
  // the sync + full-recon crons.
  setTimeout(safeRun, 90000)
}

export function stopPinelabFastReconCron() {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
  console.log('[PinelabFastRecon] Stopped.')
}
