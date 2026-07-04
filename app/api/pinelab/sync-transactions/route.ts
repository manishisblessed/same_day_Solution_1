import { NextRequest, NextResponse } from 'next/server'
import { runPinelabSync, getPinelabConfig } from '@/lib/pinelab/sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    const result = await runPinelabSync({
      merchants: body.merchants,
      fromDate: body.fromDate,
      toDate: body.toDate,
    })

    return NextResponse.json({ ...result, syncedAt: new Date().toISOString() })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function GET() {
  const config = getPinelabConfig()
  return NextResponse.json({
    message: 'Pinelab Transaction Sync endpoint',
    configuredMerchants: Object.keys(config),
    status: Object.keys(config).length > 0 ? 'configured' : 'not_configured',
  })
}
