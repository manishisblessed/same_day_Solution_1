import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { FINANCE_TAB_IDS } from '@/lib/auth-roles'

export const dynamic = 'force-dynamic'

/** Normalize an incoming tabs array: keep only known keys, expand 'all', dedupe. */
function sanitizeTabs(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  if (input.includes('all')) return [...FINANCE_TAB_IDS]
  return FINANCE_TAB_IDS.filter((id) => input.includes(id))
}

// Legacy single-department values permitted by the admin_users.department CHECK
// constraint. We deliberately avoid 'all', 'settings' and 'users' so a finance
// executive can never be treated as an effective super-admin (isEffectiveSuperAdmin)
// or user manager (assertAdminCanManageUsers). Navigation is driven by the
// `departments` array, so this legacy value is otherwise inconsequential.
const SAFE_LEGACY_DEPTS = ['wallet', 'commission', 'mdr', 'limits', 'services', 'reversals', 'disputes', 'reports']

function legacyDepartmentFor(departments: string[]): string {
  return departments.find((d) => SAFE_LEGACY_DEPTS.includes(d)) || 'reports'
}

/**
 * Resolve the Supabase Auth user id for an email so the backing admin_users row
 * id matches the auth id (required for admin_audit_log.admin_id FK). Best-effort.
 */
async function resolveAuthUserId(supabase: SupabaseClient, email: string): Promise<string | null> {
  const lower = email.toLowerCase()
  for (let page = 1; page <= 50; page++) {
    const { data } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    const users = data?.users || []
    const match = users.find((u: any) => (u.email || '').toLowerCase() === lower)
    if (match) return match.id
    if (users.length < 1000) break
  }
  return null
}

/**
 * Create or update the admin_users sub-admin row that backs a finance executive.
 * This is what gives them access to the existing admin portal + /api/admin/*
 * routes: getUserRole matches admin_users first, so they resolve as role 'admin'
 * with `departments` limited to their granted tabs (Settings is never included).
 */
async function syncFinanceAdminRow(
  supabase: SupabaseClient,
  opts: { authId?: string; email: string; name?: string; tabs?: string[]; is_active?: boolean; createdBy?: string }
): Promise<{ ok: boolean; error?: string }> {
  const { data: existing } = await supabase
    .from('admin_users')
    .select('id')
    .eq('email', opts.email)
    .maybeSingle()

  if (existing) {
    const updates: Record<string, unknown> = { admin_type: 'sub_admin' }
    if (opts.name !== undefined) updates.name = opts.name
    if (opts.tabs !== undefined) {
      updates.departments = opts.tabs
      updates.department = legacyDepartmentFor(opts.tabs)
    }
    if (opts.is_active !== undefined) updates.is_active = opts.is_active
    const { error } = await supabase.from('admin_users').update(updates).eq('id', existing.id)
    return error ? { ok: false, error: error.message } : { ok: true }
  }

  const authId = opts.authId || (await resolveAuthUserId(supabase, opts.email))
  if (!authId) return { ok: false, error: 'Could not resolve auth user id for finance executive' }

  const departments = opts.tabs || []
  const { error } = await supabase.from('admin_users').insert({
    id: authId,
    email: opts.email,
    name: opts.name || opts.email,
    admin_type: 'sub_admin',
    department: legacyDepartmentFor(departments),
    departments,
    permissions: {},
    is_active: opts.is_active ?? true,
    created_by: opts.createdBy || null,
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

let supabaseAdmin: SupabaseClient | null = null

function getSupabaseAdmin(): SupabaseClient {
  if (!supabaseAdmin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Supabase not configured')
    supabaseAdmin = createClient(url, key)
  }
  return supabaseAdmin
}

/** Same permission rule as POST /api/admin/create-user (users department or super_admin). */
async function assertAdminCanManageUsers(adminEmail: string): Promise<{ ok: true; adminId: string } | { ok: false; status: number; error: string }> {
  const supabase = getSupabaseAdmin()
  const { data: adminData, error } = await supabase
    .from('admin_users')
    .select('id, admin_type, department, departments, is_active')
    .eq('email', adminEmail)
    .single()

  if (error || !adminData) {
    return { ok: false, status: 403, error: 'User not allowed' }
  }
  if (adminData.is_active === false) {
    return { ok: false, status: 403, error: 'User not allowed' }
  }

  const adminType = adminData.admin_type || 'super_admin'
  if (adminType === 'super_admin') {
    return { ok: true, adminId: adminData.id }
  }
  if (adminType === 'sub_admin') {
    const hasUsersDepartment =
      adminData.department === 'users' ||
      adminData.department === 'all' ||
      (Array.isArray(adminData.departments) &&
        (adminData.departments.includes('users') || adminData.departments.includes('all')))
    if (hasUsersDepartment) {
      return { ok: true, adminId: adminData.id }
    }
  }
  return { ok: false, status: 403, error: 'User not allowed' }
}

/**
 * GET — list finance executives (admin only).
 */
export async function GET(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const gate = await assertAdminCanManageUsers(admin.email)
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status })
    }

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('finance_users')
      .select('id, email, name, phone, tabs, is_active, created_at, updated_at, created_by')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[finance-users GET]', error)
      return NextResponse.json({ error: 'Failed to load finance users' }, { status: 500 })
    }

    return NextResponse.json({ success: true, users: data || [] })
  } catch (e: any) {
    console.error('[finance-users GET]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST — create finance executive (Supabase Auth + finance_users row).
 * Body: { name, email, phone?, password }
 */
export async function POST(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const gate = await assertAdminCanManageUsers(admin.email)
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status })
    }

    const body = await request.json()
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
    const tabs = sanitizeTabs(body.tabs)

    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Name, email, and password are required' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (authError || !authData.user) {
      return NextResponse.json({ error: authError?.message || 'Failed to create auth user' }, { status: 400 })
    }

    const { data: row, error: insertError } = await supabase
      .from('finance_users')
      .insert({
        email,
        name,
        phone: phone || null,
        tabs,
        is_active: true,
        created_by: gate.adminId,
      })
      .select('id, email, name, phone, tabs, is_active, created_at')
      .single()

    if (insertError) {
      await supabase.auth.admin.deleteUser(authData.user.id)
      console.error('[finance-users POST] insert', insertError)
      return NextResponse.json(
        { error: insertError.message || 'Failed to save finance profile' },
        { status: 400 }
      )
    }

    // Back the finance executive with a department-scoped sub-admin row so the
    // existing admin portal + /api/admin/* routes work for them.
    const sync = await syncFinanceAdminRow(supabase, {
      authId: authData.user.id,
      email,
      name,
      tabs,
      is_active: true,
      createdBy: gate.adminId,
    })
    if (!sync.ok) {
      await supabase.from('finance_users').delete().eq('id', row.id)
      await supabase.auth.admin.deleteUser(authData.user.id)
      console.error('[finance-users POST] admin_users sync failed', sync.error)
      return NextResponse.json(
        { error: sync.error || 'Failed to grant portal access' },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true, user: row })
  } catch (e: any) {
    console.error('[finance-users POST]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT — update a finance executive's name, phone, tab access, or active state.
 * Body: { id, name?, phone?, tabs?, is_active? }
 */
export async function PUT(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const gate = await assertAdminCanManageUsers(admin.email)
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status })
    }

    const body = await request.json()
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) {
      return NextResponse.json({ error: 'Finance user id is required' }, { status: 400 })
    }

    const updates: Record<string, unknown> = {}
    if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim()
    if (typeof body.phone === 'string') updates.phone = body.phone.trim() || null
    if (body.tabs !== undefined) updates.tabs = sanitizeTabs(body.tabs)
    if (typeof body.is_active === 'boolean') updates.is_active = body.is_active

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const { data: row, error: updateError } = await supabase
      .from('finance_users')
      .update(updates)
      .eq('id', id)
      .select('id, email, name, phone, tabs, is_active, created_at')
      .single()

    if (updateError) {
      console.error('[finance-users PUT]', updateError)
      return NextResponse.json({ error: updateError.message || 'Failed to update finance user' }, { status: 400 })
    }

    // Keep the backing sub-admin row (departments/name/active state) in sync.
    const sync = await syncFinanceAdminRow(supabase, {
      email: row.email,
      name: row.name,
      tabs: Array.isArray(row.tabs) ? row.tabs : [],
      is_active: row.is_active,
      createdBy: gate.adminId,
    })
    if (!sync.ok) {
      console.error('[finance-users PUT] admin_users sync failed', sync.error)
    }

    return NextResponse.json({ success: true, user: row })
  } catch (e: any) {
    console.error('[finance-users PUT]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
