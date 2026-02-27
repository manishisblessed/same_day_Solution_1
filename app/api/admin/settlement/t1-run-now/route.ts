import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { triggerManualRun, getIsRunning } from '@/lib/cron/t1-settlement-cron'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin) {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    if (getIsRunning()) {
      return NextResponse.json(
        { error: 'T+1 settlement is already running. Please wait for it to complete.' },
        { status: 409 }
      )
    }

    console.log(`[T1 Manual] Triggered by admin ${admin.email}`)

    const result = await triggerManualRun()

    return NextResponse.json({
      success: result.success,
      message: result.message,
      processed: result.processed,
      failed: result.failed,
    })
  } catch (err: any) {
    console.error('[T1 Manual] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin) {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    return NextResponse.json({
      success: true,
      is_running: getIsRunning(),
    })
  } catch (err: any) {
    console.error('[T1 Manual] GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
