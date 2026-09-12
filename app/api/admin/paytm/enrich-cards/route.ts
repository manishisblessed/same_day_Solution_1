import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { enrichPaytmCardData } from '@/lib/paytm-enrichment/enrich'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/paytm/enrich-cards  (admin only)
 *
 * Manually run the Paytm card-detail enrichment (status-enquiry backfill) for
 * stored card rows missing card_type/card_brand. Use to back-fill the current
 * held backlog immediately instead of waiting for the cron.
 *
 * Body (optional): { limit?, cooldownMinutes?, maxAttempts?, delayMs? }
 */
export async function POST(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const result = await enrichPaytmCardData({
      limit: body.limit,
      cooldownMinutes: body.cooldownMinutes ?? 0, // manual run: ignore cooldown by default
      maxAttempts: body.maxAttempts ?? 20,
      delayMs: body.delayMs,
    })

    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    console.error('[Admin Paytm Enrich] Error:', error)
    return NextResponse.json({ success: false, error: error.message || 'Enrichment failed' }, { status: 500 })
  }
}
