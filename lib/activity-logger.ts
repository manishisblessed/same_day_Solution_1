import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Lazy-init Supabase admin client to avoid build-time env access
let _supabaseAdmin: ReturnType<typeof createClient> | null = null
function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return null
    _supabaseAdmin = createClient(url, key, { auth: { persistSession: false } })
  }
  return _supabaseAdmin
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActivityCategory =
  | 'auth' | 'bbps' | 'payout' | 'aeps' | 'pos' | 'wallet'
  | 'settlement' | 'admin' | 'scheme' | 'report' | 'beneficiary'
  | 'distributor' | 'master_dist' | 'other'

export interface GeoData {
  latitude: number | null
  longitude: number | null
  accuracy: number | null
  source: string | null
}

export interface LogActivityParams {
  user_id: string
  user_role: string
  activity_type: string
  activity_category: ActivityCategory
  activity_description?: string
  reference_id?: string
  reference_table?: string
  geo?: GeoData | null
  ip_address?: string | null
  user_agent?: string | null
  device_info?: Record<string, any> | null
  request_path?: string | null
  request_method?: string | null
  status?: 'success' | 'failed' | 'error' | 'denied'
  error_message?: string | null
  metadata?: Record<string, any> | null
}

// ---------------------------------------------------------------------------
// Geo & IP extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract geolocation data from the X-Geo-Location header.
 * Frontend sends: {"lat":28.61,"lng":77.20,"acc":15.2,"src":"gps","ts":1740000000}
 */
export function extractGeoFromRequest(request: NextRequest): GeoData {
  const empty: GeoData = { latitude: null, longitude: null, accuracy: null, source: null }
  try {
    const header = request.headers.get('x-geo-location')
    if (!header) return empty
    const parsed = JSON.parse(header)
    return {
      latitude: typeof parsed.lat === 'number' ? parsed.lat : null,
      longitude: typeof parsed.lng === 'number' ? parsed.lng : null,
      accuracy: typeof parsed.acc === 'number' ? parsed.acc : null,
      source: parsed.src || null,
    }
  } catch {
    return empty
  }
}

/**
 * Also try to extract geo from the request body (fallback for POST/PUT).
 * Expects body.geo = { latitude, longitude, accuracy, source }
 */
export function extractGeoFromBody(body: any): GeoData {
  const empty: GeoData = { latitude: null, longitude: null, accuracy: null, source: null }
  if (!body?.geo) return empty
  return {
    latitude: typeof body.geo.latitude === 'number' ? body.geo.latitude : null,
    longitude: typeof body.geo.longitude === 'number' ? body.geo.longitude : null,
    accuracy: typeof body.geo.accuracy === 'number' ? body.geo.accuracy : null,
    source: body.geo.source || null,
  }
}

/**
 * Merge geo from header and body (header takes priority).
 */
export function mergeGeo(headerGeo: GeoData, bodyGeo: GeoData): GeoData {
  return {
    latitude: headerGeo.latitude ?? bodyGeo.latitude,
    longitude: headerGeo.longitude ?? bodyGeo.longitude,
    accuracy: headerGeo.accuracy ?? bodyGeo.accuracy,
    source: headerGeo.source ?? bodyGeo.source,
  }
}

/**
 * Extract client IP from request headers.
 * Checks x-forwarded-for (Nginx/ALB/CloudFront), x-real-ip, then falls back.
 */
export function getClientIP(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp
  return null
}

// ---------------------------------------------------------------------------
// Main logging function
// ---------------------------------------------------------------------------

/**
 * Log a user activity with geolocation to the activity_logs table.
 * Also updates the user_locations table with last known location.
 *
 * This function is fire-and-forget — it NEVER throws and NEVER blocks
 * the calling API route. If logging fails, the error is printed but
 * the transaction/response is NOT affected.
 */
export async function logActivity(params: LogActivityParams): Promise<string | null> {
  try {
    const supabase = getSupabaseAdmin()
    if (!supabase) {
      console.error('[ActivityLogger] Supabase not configured, skipping log')
      return null
    }

    const { data, error } = await (supabase.from('activity_logs') as any).insert({
      user_id: params.user_id,
      user_role: params.user_role,
      activity_type: params.activity_type,
      activity_category: params.activity_category,
      activity_description: params.activity_description || null,
      reference_id: params.reference_id || null,
      reference_table: params.reference_table || null,
      latitude: params.geo?.latitude ?? null,
      longitude: params.geo?.longitude ?? null,
      geo_accuracy: params.geo?.accuracy ?? null,
      geo_source: params.geo?.source ?? null,
      ip_address: params.ip_address ?? null,
      user_agent: params.user_agent ?? null,
      device_info: params.device_info ?? null,
      request_path: params.request_path ?? null,
      request_method: params.request_method ?? null,
      status: params.status ?? 'success',
      error_message: params.error_message ?? null,
      metadata: params.metadata ?? null,
    }).select('id').single()

    if (error) {
      console.error('[ActivityLogger] Insert error:', error.message, error.code, error.details)
      if (error.code === '42P01') {
        console.error('[ActivityLogger] Table "activity_logs" does not exist. Run the geolocation tracking migration SQL.')
      }
      return null
    }

    const logId = data?.id ?? null

    // Update user_locations (non-blocking)
    if (params.geo?.latitude != null && params.geo?.longitude != null) {
      ;(supabase.from('user_locations') as any).upsert({
        user_id: params.user_id,
        user_role: params.user_role,
        latitude: params.geo.latitude,
        longitude: params.geo.longitude,
        geo_accuracy: params.geo.accuracy,
        geo_source: params.geo.source,
        ip_address: params.ip_address ?? null,
        last_activity_type: params.activity_type,
        last_activity_id: logId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' }).then(({ error: locErr }: { error: any }) => {
        if (locErr) console.error('[ActivityLogger] user_locations upsert error:', locErr.message)
      })
    }

    return logId
  } catch (err: any) {
    console.error('[ActivityLogger] Unexpected error:', err?.message || err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Convenience: extract everything from a NextRequest in one call
// ---------------------------------------------------------------------------

export interface RequestContext {
  geo: GeoData
  ip: string | null
  userAgent: string | null
  path: string
  method: string
}

/**
 * Extract all context needed for activity logging from a NextRequest.
 * Call this once at the top of your route handler.
 */
export function getRequestContext(request: NextRequest): RequestContext {
  return {
    geo: extractGeoFromRequest(request),
    ip: getClientIP(request),
    userAgent: request.headers.get('user-agent'),
    path: request.nextUrl.pathname,
    method: request.method,
  }
}

/**
 * Shorthand: log activity using RequestContext + user info.
 * Simplifies route integration to just 2 lines:
 *   const ctx = getRequestContext(request)
 *   await logActivityFromContext(ctx, user, { ... })
 */
export async function logActivityFromContext(
  ctx: RequestContext,
  user: { id?: string; partner_id?: string; role: string; email?: string } | null,
  details: {
    activity_type: string
    activity_category: ActivityCategory
    activity_description?: string
    reference_id?: string
    reference_table?: string
    status?: 'success' | 'failed' | 'error' | 'denied'
    error_message?: string
    metadata?: Record<string, any>
  }
): Promise<string | null> {
  if (!user) return null
  const userId = user.partner_id || user.id || 'unknown'
  return logActivity({
    user_id: userId,
    user_role: user.role,
    ...details,
    geo: ctx.geo,
    ip_address: ctx.ip,
    user_agent: ctx.userAgent,
    request_path: ctx.path,
    request_method: ctx.method,
  })
}
