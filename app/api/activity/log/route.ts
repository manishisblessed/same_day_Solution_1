import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { logActivity, extractGeoFromRequest, extractGeoFromBody, mergeGeo, getClientIP } from '@/lib/activity-logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/activity/log
 *
 * Generic activity logging endpoint called by the frontend for events
 * that don't go through a specific API route (login, logout, page views, etc).
 *
 * Body: {
 *   activity_type: string,
 *   activity_category: string,
 *   activity_description?: string,
 *   reference_id?: string,
 *   reference_table?: string,
 *   status?: string,
 *   error_message?: string,
 *   metadata?: object,
 *   geo?: { latitude, longitude, accuracy, source }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const headerGeo = extractGeoFromRequest(request)
    const bodyGeo = extractGeoFromBody(body)
    const geo = mergeGeo(headerGeo, bodyGeo)
    const ip = getClientIP(request)

    const logId = await logActivity({
      user_id: user.partner_id || user.id,
      user_role: user.role,
      activity_type: body.activity_type || 'unknown',
      activity_category: body.activity_category || 'other',
      activity_description: body.activity_description || null,
      reference_id: body.reference_id || null,
      reference_table: body.reference_table || null,
      geo,
      ip_address: ip,
      user_agent: request.headers.get('user-agent'),
      request_path: '/api/activity/log',
      request_method: 'POST',
      status: body.status || 'success',
      error_message: body.error_message || null,
      metadata: body.metadata || null,
    })

    return NextResponse.json({ success: true, log_id: logId })
  } catch (error: any) {
    console.error('[Activity Log API] Error:', error?.message || error)
    return NextResponse.json({ error: 'Failed to log activity' }, { status: 500 })
  }
}
