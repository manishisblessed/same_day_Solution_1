import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/activity/log/update-geo
 *
 * Backfill geolocation on an activity log entry that was created
 * before the browser granted location permission (e.g. the login event).
 *
 * Body: { log_id: string, geo: { latitude, longitude, accuracy, source } }
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { log_id, geo } = body

    if (!log_id || !geo?.latitude || !geo?.longitude) {
      return NextResponse.json({ error: 'Missing log_id or geo data' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const userId = user.partner_id || user.id

    // Only allow updating own activity logs that have no geo yet
    const { error } = await supabase
      .from('activity_logs')
      .update({
        latitude: geo.latitude,
        longitude: geo.longitude,
        geo_accuracy: geo.accuracy ?? null,
        geo_source: geo.source ?? null,
      })
      .eq('id', log_id)
      .eq('user_id', userId)
      .is('latitude', null)

    if (error) {
      console.error('[Activity Geo Update] Error:', error.message)
      return NextResponse.json({ error: 'Failed to update geo' }, { status: 500 })
    }

    // Also update user_locations
    supabase
      .from('user_locations')
      .upsert({
        user_id: userId,
        user_role: user.role,
        latitude: geo.latitude,
        longitude: geo.longitude,
        geo_accuracy: geo.accuracy ?? null,
        geo_source: geo.source ?? null,
        last_activity_type: 'login',
        last_activity_id: log_id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .then(({ error: locErr }) => {
        if (locErr) console.error('[Activity Geo Update] user_locations upsert error:', locErr.message)
      })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Activity Geo Update] Error:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
