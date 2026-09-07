import { NextRequest, NextResponse } from 'next/server'
import { runPinelabReconcile } from '@/lib/pinelab/reconcile'
import { getPinelabConfig } from '@/lib/pinelab/sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Pine Labs reconciliation endpoint.
 *
 * Re-checks captured Pine Labs transactions against the live API and corrects
 * any that Pine Labs now reports as FAILED / VOID / REFUND, and verifies the
 * settled ones for safe payout. Never moves money.
 *
 * Auth: x-cron-secret header (same as the sync endpoint).
 * Body (all optional):
 *   { merchants?: string[], fromDate?: "YYYY-MM-DDTHH:mm:ss", toDate?: string,
 *     cutoffDays?: number, dryRun?: boolean }
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const headerSecret = request.headers.get('x-cron-secret')
  if (cronSecret && headerSecret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any = {}
  try {
    body = await request.json()
  } catch {
    // empty body is fine
  }

  try {
    const result = await runPinelabReconcile({
      merchants: body.merchants,
      fromDate: body.fromDate,
      toDate: body.toDate,
      cutoffDays: body.cutoffDays,
      apply: body.dryRun !== true, // dryRun:true → compute only
    })
    return NextResponse.json({ ...result, reconciledAt: new Date().toISOString() })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function GET() {
  const config = getPinelabConfig()
  return NextResponse.json({
    message: 'Pine Labs reconciliation endpoint',
    configuredMerchants: Object.keys(config),
    status: Object.keys(config).length > 0 ? 'configured' : 'not_configured',
  })
}
