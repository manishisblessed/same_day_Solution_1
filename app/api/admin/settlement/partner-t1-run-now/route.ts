import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin authentication required' }, { status: 401 })
    }

    const { triggerPartnerManualRun } = await import('@/lib/cron/t1-settlement-cron-partners')

    console.log('[Admin] Triggering manual partner T+1 settlement run')

    const result = await triggerPartnerManualRun()

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Error triggering manual settlement run:', error)
    return NextResponse.json(
      { 
        success: false, 
        message: error.message || 'Failed to trigger settlement',
        processed: 0,
        failed: 0,
        error: error.message 
      },
      { status: 500 }
    )
  }
}
