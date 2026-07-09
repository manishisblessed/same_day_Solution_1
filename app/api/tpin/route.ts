import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
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

/**
 * Resolve the DB table, lookup column, and RPC function names
 * based on user role so retailers and partners share the same API.
 */
function tpinConfig(role: string) {
  if (role === 'partner') {
    return {
      table: 'partners' as const,
      idColumn: 'id' as const,
      verifyFn: 'verify_partner_tpin' as const,
      setFn: 'set_partner_tpin' as const,
      verifyParam: 'p_partner_id' as const,
      setParam: 'p_partner_id' as const,
    }
  }
  return {
    table: 'retailers' as const,
    idColumn: 'partner_id' as const,
    verifyFn: 'verify_retailer_tpin' as const,
    setFn: 'set_retailer_tpin' as const,
    verifyParam: 'p_retailer_id' as const,
    setParam: 'p_retailer_id' as const,
  }
}

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * GET /api/tpin — Get TPIN status for the current user (retailer or partner)
 */
export async function GET(request: NextRequest) {
  try {
    const { user, method } = await getCurrentUserWithFallback(request)

    if (!user) {
      console.error('[TPIN GET] Auth failed: no user found, method:', method)
      const response = NextResponse.json({ error: 'Session expired. Please login again.' }, { status: 401 })
      return addCorsHeaders(request, response)
    }
    if (!user.partner_id) {
      console.error('[TPIN GET] Auth failed: user has no partner_id, role:', user.role, 'email:', user.email)
      const response = NextResponse.json({ error: 'TPIN is not available for this role' }, { status: 403 })
      return addCorsHeaders(request, response)
    }

    const cfg = tpinConfig(user.role)

    const { data: record, error } = await supabaseAdmin
      .from(cfg.table)
      .select('tpin_enabled, tpin_locked_until, tpin_failed_attempts')
      .eq(cfg.idColumn, user.partner_id)
      .maybeSingle()

    if (error) {
      console.error('[TPIN] Error fetching status:', error)
      const response = NextResponse.json(
        { success: false, error: 'Failed to fetch TPIN status' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    if (!record) {
      const response = NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      )
      return addCorsHeaders(request, response)
    }

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, { activity_type: 'tpin_verify', activity_category: 'auth' }).catch(() => {})

    const response = NextResponse.json({
      success: true,
      tpin_enabled: record.tpin_enabled || false,
      is_locked: record.tpin_locked_until ? new Date(record.tpin_locked_until) > new Date() : false,
      locked_until: record.tpin_locked_until,
      failed_attempts: record.tpin_failed_attempts || 0,
    })

    return addCorsHeaders(request, response)

  } catch (error: any) {
    console.error('[TPIN] Unexpected error:', error)
    const response = NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

/**
 * POST /api/tpin — Set or change TPIN for the current user (retailer or partner)
 *
 * Body: { tpin: string, current_tpin?: string }
 */
export async function POST(request: NextRequest) {
  const rl = rateLimit(request, RATE_LIMITS.tpin)
  if (rl.limited) return addCorsHeaders(request, rl.response!)

  try {
    const body = await request.json()
    const { tpin, current_tpin } = body

    const { user, method } = await getCurrentUserWithFallback(request)

    if (!user) {
      console.error('[TPIN POST] Auth failed: no user found, method:', method)
      const response = NextResponse.json({ error: 'Session expired. Please login again.' }, { status: 401 })
      return addCorsHeaders(request, response)
    }
    if (!user.partner_id) {
      console.error('[TPIN POST] Auth failed: user has no partner_id, role:', user.role, 'email:', user.email)
      const response = NextResponse.json({ error: 'TPIN is not available for this role' }, { status: 403 })
      return addCorsHeaders(request, response)
    }

    if (!tpin || tpin.length !== 4 || !/^\d{4}$/.test(tpin)) {
      const response = NextResponse.json(
        { success: false, error: 'TPIN must be exactly 4 digits' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const cfg = tpinConfig(user.role)

    // Look up current TPIN state
    const { data: record, error: fetchError } = await supabaseAdmin
      .from(cfg.table)
      .select('tpin_enabled, tpin_hash, tpin_locked_until')
      .eq(cfg.idColumn, user.partner_id)
      .maybeSingle()

    if (fetchError || !record) {
      const response = NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      )
      return addCorsHeaders(request, response)
    }

    if (record.tpin_locked_until && new Date(record.tpin_locked_until) > new Date()) {
      const response = NextResponse.json(
        {
          success: false,
          error: 'Account is locked due to too many failed attempts',
          locked_until: record.tpin_locked_until
        },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    // If TPIN already set, verify current TPIN first
    if (record.tpin_enabled && record.tpin_hash) {
      if (!current_tpin) {
        const response = NextResponse.json(
          { success: false, error: 'Current TPIN is required to change TPIN' },
          { status: 400 }
        )
        return addCorsHeaders(request, response)
      }

      const { data: verifyResult, error: verifyError } = await supabaseAdmin.rpc(cfg.verifyFn, {
        [cfg.verifyParam]: user.partner_id,
        p_tpin: current_tpin
      })

      if (verifyError) {
        console.error('[TPIN] Verification error:', verifyError)
        const response = NextResponse.json(
          { success: false, error: 'Failed to verify current TPIN' },
          { status: 500 }
        )
        return addCorsHeaders(request, response)
      }

      if (!verifyResult?.success) {
        const response = NextResponse.json(
          {
            success: false,
            error: verifyResult?.error || 'Current TPIN is incorrect',
            attempts_remaining: verifyResult?.attempts_remaining
          },
          { status: 400 }
        )
        return addCorsHeaders(request, response)
      }
    }

    // Set new TPIN
    const { error: setError } = await supabaseAdmin.rpc(cfg.setFn, {
      [cfg.setParam]: user.partner_id,
      p_tpin: tpin
    })

    if (setError) {
      console.error('[TPIN] Set error:', setError)
      const response = NextResponse.json(
        { success: false, error: setError.message || 'Failed to set TPIN' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    console.log('[TPIN] TPIN set successfully for:', user.partner_id, 'role:', user.role)

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, { activity_type: 'tpin_set', activity_category: 'auth' }).catch(() => {})

    const response = NextResponse.json({
      success: true,
      message: record.tpin_enabled ? 'TPIN changed successfully' : 'TPIN set successfully',
    })

    return addCorsHeaders(request, response)

  } catch (error: any) {
    console.error('[TPIN] Unexpected error:', error)
    const response = NextResponse.json(
      { success: false, error: error.message || 'An unexpected error occurred' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
