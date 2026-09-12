let intervalHandle: ReturnType<typeof setInterval> | null = null
let isRunning = false

async function runEnrich() {
  if (isRunning) {
    console.log('[PaytmEnrichCron] Skip: already running')
    return
  }
  isRunning = true
  const startMs = Date.now()

  try {
    const { enrichPaytmCardData } = await import('@/lib/paytm-enrichment/enrich')
    const res = await enrichPaytmCardData()
    const elapsed = Date.now() - startMs
    if (res.scanned > 0 || res.errors > 0) {
      console.log(
        `[PaytmEnrichCron] scanned=${res.scanned} enriched=${res.enriched} noData=${res.noData}` +
          `${res.errors ? ` ERR=${res.errors}` : ''} (${elapsed}ms)`
      )
    }
  } catch (err: any) {
    console.error(`[PaytmEnrichCron] Error: ${err?.message || err}`)
  } finally {
    isRunning = false
  }
}

export async function initPaytmCardEnrichmentCron() {
  const intervalSec = parseInt(process.env.PAYTM_ENRICH_INTERVAL_SECONDS || '180', 10)
  const intervalMs = intervalSec * 1000

  const safeRun = () => {
    runEnrich().catch((err) => console.error('[PaytmEnrichCron] Unhandled:', err))
  }

  intervalHandle = setInterval(safeRun, intervalMs)
  console.log(`[PaytmEnrichCron] Scheduled every ${intervalSec}s`)

  // Delay first run to let Next.js finish initial compilation.
  setTimeout(safeRun, 40000)
}

export function stopPaytmCardEnrichmentCron() {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
  console.log('[PaytmEnrichCron] Stopped.')
}
