import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { runSubscriptionAutoDebit } from '@/lib/subscription/run-auto-debit'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

export const dynamic = 'force-dynamic'

/** POST - Run auto-debit for subscriptions due today (admin or cron). */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const result = await runSubscriptionAutoDebit()

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, {
      activity_type: 'admin_subscription_run_auto_debit',
      activity_category: 'subscription',
      activity_description: `Admin ran subscription auto-debit: ${result.completed} completed, ${result.failed} failed, ${result.commissionsCreated} commissions.`,
      status: result.failed > 0 && result.completed === 0 ? 'failed' : 'success',
      metadata: { processed: result.processed, completed: result.completed, failed: result.failed, commissionsCreated: result.commissionsCreated },
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      processed: result.processed,
      completed: result.completed,
      failed: result.failed,
      commissionsCreated: result.commissionsCreated,
      results: result.results,
    })
  } catch (e: any) {
    console.error('[Run Auto-Debit]', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
