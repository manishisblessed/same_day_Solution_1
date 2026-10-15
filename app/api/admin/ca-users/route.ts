import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

/**
 * Same permission rule as finance-users / create-user:
 * super_admin, or a sub-admin with the 'users' (or 'all') department.
 */
async function assertAdminCanManageUsers(
  adminEmail: string
): Promise<{ ok: true; adminId: string } | { ok: false; status: number; error: string }> {
  const supabase = getSupabaseAdmin()
  const { data: adminData, error } = await supabase
    .from('admin_users')
    .select('id, admin_type, department, departments, is_active')
    .eq('email', adminEmail)
    .single()

  if (error || !adminData) return { ok: false, status: 403, error: 'User not allowed' }
  if (adminData.is_active === false) return { ok: false, status: 403, error: 'User not allowed' }

  const adminType = adminData.admin_type || 'super_admin'
  if (adminType === 'super_admin') return { ok: true, adminId: adminData.id }
  if (adminType === 'sub_admin') {
    const hasUsersDept =
      adminData.department === 'users' ||
      adminData.department === 'all' ||
      (Array.isArray(adminData.departments) &&
        (adminData.departments.includes('users') || adminData.departments.includes('all')))
    if (hasUsersDept) return { ok: true, adminId: adminData.id }
  }
  return { ok: false, status: 403, error: 'User not allowed' }
}

/** GET — list CA executives (admin only). */
export async function GET(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const gate = await assertAdminCanManageUsers(admin.email)
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('ca_users')
      .select('id, email, name, phone, is_active, created_at, updated_at, created_by')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[ca-users GET]', error)
      return NextResponse.json({ error: 'Failed to load CA users' }, { status: 500 })
    }
    return NextResponse.json({ success: true, users: data || [] })
  } catch (e: any) {
    console.error('[ca-users GET]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST — create CA executive (Supabase Auth + ca_users row).
 * Body: { name, email, phone?, password }
 */
export async function POST(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const gate = await assertAdminCanManageUsers(admin.email)
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

    const body = await request.json()
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const phone = typeof body.phone === 'string' ? body.phone.trim() : ''

    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Name, email, and password are required' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    // Reject duplicates up front for a clean message.
    const { data: existing } = await supabase
      .from('ca_users')
      .select('id')
      .eq('email', email)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ error: 'A CA user with this email already exists' }, { status: 400 })
    }

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (authError || !authData.user) {
      return NextResponse.json({ error: authError?.message || 'Failed to create auth user' }, { status: 400 })
    }

    const { data: row, error: insertError } = await supabase
      .from('ca_users')
      .insert({
        email,
        name,
        phone: phone || null,
        is_active: true,
        created_by: admin.email,
      })
      .select('id, email, name, phone, is_active, created_at')
      .single()

    if (insertError) {
      await supabase.auth.admin.deleteUser(authData.user.id)
      console.error('[ca-users POST] insert', insertError)
      return NextResponse.json({ error: insertError.message || 'Failed to save CA profile' }, { status: 400 })
    }

    return NextResponse.json({ success: true, user: row })
  } catch (e: any) {
    console.error('[ca-users POST]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT — update a CA executive's name, phone, or active state.
 * Body: { id, name?, phone?, is_active? }
 */
export async function PUT(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const gate = await assertAdminCanManageUsers(admin.email)
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

    const body = await request.json()
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) return NextResponse.json({ error: 'CA user id is required' }, { status: 400 })

    const updates: Record<string, unknown> = {}
    if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim()
    if (typeof body.phone === 'string') updates.phone = body.phone.trim() || null
    if (typeof body.is_active === 'boolean') updates.is_active = body.is_active

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const { data: row, error: updateError } = await supabase
      .from('ca_users')
      .update(updates)
      .eq('id', id)
      .select('id, email, name, phone, is_active, created_at')
      .single()

    if (updateError) {
      console.error('[ca-users PUT]', updateError)
      return NextResponse.json({ error: updateError.message || 'Failed to update CA user' }, { status: 400 })
    }
    return NextResponse.json({ success: true, user: row })
  } catch (e: any) {
    console.error('[ca-users PUT]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
