import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { apiHandler } from '@/lib/api-wrapper'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is missing')
  if (!supabaseServiceKey || supabaseServiceKey.trim() === '' || supabaseServiceKey === 'your_supabase_service_role_key') {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing or invalid')
  }
  return createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
}

// Only retailers, distributors and partners have a T-PIN.
const ROLE_CONFIG: Record<string, { table: string; idField: string; setFn: string; setParam: string }> = {
  retailer: { table: 'retailers', idField: 'partner_id', setFn: 'set_retailer_tpin', setParam: 'p_retailer_id' },
  distributor: { table: 'distributors', idField: 'partner_id', setFn: 'set_distributor_tpin', setParam: 'p_distributor_id' },
  partner: { table: 'partners', idField: 'id', setFn: 'set_partner_tpin', setParam: 'p_partner_id' },
}

async function handleResetTpin(request: NextRequest) {
  const supabase = getSupabaseClient()

  const { user: admin } = await getCurrentUserWithFallback(request)
  if (!admin) {
    return NextResponse.json({ error: 'Session expired. Please login again.', code: 'SESSION_EXPIRED' }, { status: 401 })
  }
  if (admin.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  // Strict super-admin check.
  const { data: adminData } = await supabase
    .from('admin_users')
    .select('id, admin_type, is_active')
    .eq('email', admin.email)
    .single()

  if (!adminData || adminData.is_active === false || adminData.admin_type !== 'super_admin') {
    return NextResponse.json({ error: 'This action is restricted to super-admins only' }, { status: 403 })
  }

  const body = await request.json()
  const { user_id, user_role, new_tpin } = body

  if (!user_id || !user_role || !new_tpin) {
    return NextResponse.json({ error: 'user_id, user_role, and new_tpin are required' }, { status: 400 })
  }

  const cfg = ROLE_CONFIG[user_role]
  if (!cfg) {
    return NextResponse.json({ error: `T-PIN is not supported for role "${user_role}"` }, { status: 400 })
  }

  if (!/^\d{4,6}$/.test(String(new_tpin))) {
    return NextResponse.json({ error: 'T-PIN must be 4 to 6 digits' }, { status: 400 })
  }

  const { data: targetUser, error: userError } = await supabase
    .from(cfg.table)
    .select(`${cfg.idField}, name, email`)
    .eq(cfg.idField, user_id)
    .single()

  if (userError || !targetUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // set_*_tpin hashes with bcrypt, enables the TPIN, and clears lockout/attempts.
  const { error: rpcError } = await supabase.rpc(cfg.setFn, {
    [cfg.setParam]: user_id,
    p_tpin: String(new_tpin),
  })

  if (rpcError) {
    console.error('[Reset TPIN] RPC error:', rpcError)
    return NextResponse.json({ error: rpcError.message || 'Failed to reset T-PIN' }, { status: 500 })
  }

  // Audit log (best-effort).
  try {
    const ipAddress =
      request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    const userAgent = request.headers.get('user-agent') || 'unknown'
    await supabase.from('admin_audit_log').insert({
      admin_id: adminData.id,
      action_type: 'tpin_reset',
      target_user_id: user_id,
      target_user_role: user_role,
      ip_address: ipAddress,
      user_agent: userAgent,
      remarks: `T-PIN reset for ${(targetUser as any).email || user_id}`,
    })
  } catch {
    // audit table may not exist — non-fatal
  }

  const ctx = getRequestContext(request)
  logActivityFromContext(ctx, admin, {
    activity_type: 'admin_reset_tpin',
    activity_category: 'admin',
    activity_description: `Super-admin reset T-PIN for ${(targetUser as any).email || user_id}`,
    metadata: { target_user_id: user_id, target_user_role: user_role },
  }).catch(() => {})

  return NextResponse.json({
    success: true,
    message: `T-PIN reset successfully for ${(targetUser as any).name || user_id}`,
  })
}

export const POST = apiHandler(handleResetTpin)
