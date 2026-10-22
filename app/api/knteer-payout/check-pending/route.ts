/**
 * POST /api/knteer-payout/check-pending
 *
 * Manual or cron-triggered sweep of PENDING Knteer payout transactions.
 * Mirrors /api/settlement-2/status pattern.
 *
 * Auth: requires CRON_SECRET header (cron) or admin role (manual).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { normalizeMasterPartner } from '@/lib/partner-access'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { createClient } from '@supabase/supabase-js'
import { resolvePendingKnteerPayouts } from '@/lib/knteer/resolve-pending'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function OPTIONS(request: NextRequest) {
  const res = handleCorsPreflight(request)
  return res || new NextResponse(null, { status: 204 })
}

export async function POST(request: NextRequest) {
  // ── Auth: cron secret OR admin session ────────────────────────────────────
  const cronSecret = request.headers.get('x-cron-secret') || request.headers.get('authorization')?.replace('Bearer ', '')
  const isCron = cronSecret && cronSecret === process.env.CRON_SECRET

  if (!isCron) {
    try {
      const { user } = await getCurrentUserWithFallback(request)
      normalizeMasterPartner(user)
      if (!user || user.role !== 'admin') {
        return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 }))
      }
    } catch {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 }))
    }
  }

  try {
    const body = await request.json().catch(() => ({}))
    const { staleMinutes = 2, hardTimeoutMinutes = 60, limit = 50 } = body

    console.log('[Knteer CheckPending] Starting sweep:', { staleMinutes, hardTimeoutMinutes, limit, isCron })

    const result = await resolvePendingKnteerPayouts(supabaseAdmin, {
      staleMinutes,
      hardTimeoutMinutes,
      limit,
    })

    console.log('[Knteer CheckPending] Done:', result)

    return addCorsHeaders(request, NextResponse.json({ success: true, ...result }))
  } catch (err: any) {
    console.error('[Knteer CheckPending] Error:', err)
    return addCorsHeaders(request, NextResponse.json({ success: false, error: err.message }, { status: 500 }))
  }
}
