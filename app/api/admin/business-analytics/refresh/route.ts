import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { isAdminOrFinance } from '@/lib/auth-roles'
import { createClient } from '@supabase/supabase-js'
import { getEnv } from '@/lib/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Rebuilds the business-analytics materialized views.
 *
 * Auth (either):
 *   - Cron: header `x-cron-secret` matching process.env.CRON_SECRET
 *   - Admin/finance session
 *
 * Schedule this once a day from your existing cron scheduler, e.g.:
 *   curl -X POST https://<host>/api/admin/business-analytics/refresh \
 *        -H "x-cron-secret: $CRON_SECRET"
 */
export async function POST(request: NextRequest) {
  try {
    const cronSecret = request.headers.get('x-cron-secret')
    const isAuthorizedCron = !!(cronSecret && process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET)

    if (!isAuthorizedCron) {
      const { user } = await getCurrentUserWithFallback(request)
      if (!user) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }
      if (!isAdminOrFinance(user)) {
        return NextResponse.json({ error: 'Unauthorized: admin or finance access required' }, { status: 403 })
      }
    }

    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL')
    const supabaseServiceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const startedAt = Date.now()
    const { error } = await supabase.rpc('refresh_business_analytics')
    if (error) {
      console.error('[Business Analytics Refresh] RPC error:', error)
      // 42P01 = undefined_table → views not created yet
      const hint = error.code === '42P01'
        ? 'Materialized views are missing — run BUSINESS-ANALYTICS-RUN-IN-SUPABASE.sql in Supabase first.'
        : undefined
      return NextResponse.json({ error: error.message, hint }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      refreshed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      via: isAuthorizedCron ? 'cron' : 'admin',
    })
  } catch (e: any) {
    console.error('[Business Analytics Refresh] error:', e)
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 })
  }
}
