import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback, AuthNetworkError } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

/**
 * Resolve the authenticated user's AuthUser profile via service role.
 * Used by the browser instead of direct role-table queries (which will be revoked).
 *
 * Optional body: { email, roleHint } for post-login resolve when cookies may lag.
 * When roleHint is provided with a Bearer token matching that email, resolve that role table.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json({ user: null }, { status: 401 })
    }
    return NextResponse.json({ user })
  } catch (err: any) {
    if (err instanceof AuthNetworkError) {
      return NextResponse.json({ error: 'Auth service temporarily unavailable' }, { status: 503 })
    }
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const roleHint = body?.roleHint as string | undefined
    const emailHint = body?.email as string | undefined

    // Prefer full auth resolution
    try {
      const { user } = await getCurrentUserWithFallback(request, { skipSessionCheck: true })
      if (user) {
        // If roleHint asks for partner but we got partner, or sub_partner, return as-is
        return NextResponse.json({ user })
      }
    } catch (err: any) {
      if (!(err instanceof AuthNetworkError)) throw err
    }

    // Fallback: Bearer token + roleHint for completeSignIn race
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ') || !emailHint || !roleHint) {
      return NextResponse.json({ user: null, error: 'Authentication required' }, { status: 401 })
    }

    const token = authHeader.slice(7)
    const admin = getSupabaseAdmin()
    const { data: authData, error: authErr } = await admin.auth.getUser(token)
    if (authErr || !authData?.user?.email) {
      return NextResponse.json({ user: null, error: 'Invalid token' }, { status: 401 })
    }
    const email = authData.user.email
    if (email.toLowerCase() !== String(emailHint).toLowerCase()) {
      return NextResponse.json({ user: null, error: 'Email mismatch' }, { status: 403 })
    }

    const userId = authData.user.id
    let tableName = ''
    switch (roleHint) {
      case 'retailer': tableName = 'retailers'; break
      case 'distributor': tableName = 'distributors'; break
      case 'master_distributor': tableName = 'master_distributors'; break
      case 'admin': tableName = 'admin_users'; break
      case 'partner': tableName = 'partners'; break
      case 'sub_partner': tableName = 'sub_partners'; break
      case 'finance_executive': tableName = 'finance_users'; break
      default:
        return NextResponse.json({ user: null, error: 'Invalid role' }, { status: 400 })
    }

    let q = admin.from(tableName).select('*').eq('email', email)
    if (roleHint === 'finance_executive') q = q.eq('is_active', true)
    else if (roleHint !== 'admin') q = q.eq('status', 'active')

    let { data, error } = await q.maybeSingle()
    let resolvedRole = roleHint

    if ((!data || error) && roleHint === 'partner') {
      const sub = await admin
        .from('sub_partners')
        .select('*')
        .eq('email', email)
        .eq('status', 'active')
        .maybeSingle()
      if (sub.data) {
        data = sub.data
        error = null
        resolvedRole = 'sub_partner'
      }
    }

    if (!data || error) {
      return NextResponse.json({ user: null, error: 'No active account' }, { status: 404 })
    }

    const user: any = {
      id: userId,
      email,
      role: resolvedRole,
      name: data.name,
      partner_id:
        resolvedRole === 'partner' ? data.id
          : resolvedRole === 'sub_partner' ? data.parent_partner_id
          : data.partner_id,
    }
    if (resolvedRole === 'finance_executive' && data.phone) user.phone = data.phone
    if (resolvedRole === 'sub_partner') {
      user.sub_partner_id = data.id
      user.permissions = data.permissions || {}
    }

    return NextResponse.json({ user })
  } catch (err: any) {
    if (err instanceof AuthNetworkError) {
      return NextResponse.json({ error: 'Auth service temporarily unavailable' }, { status: 503 })
    }
    console.error('[auth/me POST]', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
