import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { authorizeSubPartner, normalizeMasterPartner } from '@/lib/partner-access'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

/** Role → table / column / verify RPC. Mirrors /api/tpin. */
function tpinConfig(role: string) {
  if (role === 'partner') {
    return { table: 'partners' as const, idColumn: 'id' as const, verifyFn: 'verify_partner_tpin' as const, verifyParam: 'p_partner_id' as const }
  }
  if (role === 'distributor') {
    return { table: 'distributors' as const, idColumn: 'partner_id' as const, verifyFn: 'verify_distributor_tpin' as const, verifyParam: 'p_distributor_id' as const }
  }
  return { table: 'retailers' as const, idColumn: 'partner_id' as const, verifyFn: 'verify_retailer_tpin' as const, verifyParam: 'p_retailer_id' as const }
}

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * POST /api/tpin/verify — Verify a user's TPIN WITHOUT performing any money
 * movement. Used by the mobile app to resume a superseded (single-session
 * "replaced") session without re-entering the account password.
 *
 * Uses skipSessionCheck so it works while the caller's own session row is
 * inactive (the whole point of re-auth). Still requires a valid Supabase
 * Bearer token, so it cannot be called by an unauthenticated client.
 *
 * Body: { tpin: string }
 */
export async function POST(request: NextRequest) {
  const rl = rateLimit(request, RATE_LIMITS.tpin)
  if (rl.limited) return addCorsHeaders(request, rl.response!)

  try {
    const body = await request.json().catch(() => ({}))
    const { tpin } = body

    const { user } = await getCurrentUserWithFallback(request, { skipSessionCheck: true })
    normalizeMasterPartner(user)

    if (!user) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Session expired. Please login again.' }, { status: 401 }))
    }
    if (!user.partner_id) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'TPIN is not available for this role' }, { status: 403 }))
    }

    const access = authorizeSubPartner(user)
    if (!access.ok) return access.response

    if (!tpin || tpin.length !== 4 || !/^\d{4}$/.test(tpin)) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'TPIN must be exactly 4 digits' }, { status: 400 }))
    }

    const cfg = tpinConfig(user.role)

    const { data: record, error: fetchError } = await supabaseAdmin
      .from(cfg.table)
      .select('tpin_enabled, tpin_hash, tpin_locked_until')
      .eq(cfg.idColumn, user.partner_id)
      .maybeSingle()

    if (fetchError || !record) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'User not found' }, { status: 404 }))
    }

    if (record.tpin_locked_until && new Date(record.tpin_locked_until as string) > new Date()) {
      return addCorsHeaders(request, NextResponse.json(
        { success: false, error: 'Account is locked due to too many failed attempts', locked_until: record.tpin_locked_until },
        { status: 403 }
      ))
    }

    if (!record.tpin_enabled || !record.tpin_hash) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'TPIN is not set' }, { status: 400 }))
    }

    const { data: verifyResult, error: verifyError } = await supabaseAdmin.rpc(cfg.verifyFn, {
      [cfg.verifyParam]: user.partner_id,
      p_tpin: tpin,
    })

    if (verifyError) {
      console.error('[TPIN verify] RPC error:', verifyError)
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Failed to verify TPIN' }, { status: 500 }))
    }

    if (!verifyResult?.success) {
      return addCorsHeaders(request, NextResponse.json(
        { success: false, error: verifyResult?.error || 'Incorrect TPIN', attempts_remaining: verifyResult?.attempts_remaining },
        { status: 400 }
      ))
    }

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, { activity_type: 'tpin_verify', activity_category: 'auth' }).catch(() => {})

    return addCorsHeaders(request, NextResponse.json({ success: true }))
  } catch (error: any) {
    console.error('[TPIN verify] Unexpected error:', error)
    return addCorsHeaders(request, NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 }))
  }
}
