import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Lightweight liveness probe for the external watchdog (scripts/monitoring).
 * Intentionally does NO database work so it stays fast and reflects only whether
 * the Node event loop is responsive (the exact thing that hung during the OOM).
 */
export async function GET() {
  const mem = process.memoryUsage()
  return NextResponse.json({
    status: 'ok',
    uptime_s: Math.round(process.uptime()),
    rss_mb: Math.round(mem.rss / 1024 / 1024),
    heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
    ts: new Date().toISOString(),
  })
}
