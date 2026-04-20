import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'

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
      .select('id, email, name, phone, is_active, created_at, updated_at, created_by')
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
        is_active: true,
        created_by: gate.adminId,
      })
      .select('id, email, name, phone, is_active, created_at')
      .single()

    if (insertError) {
      await supabase.auth.admin.deleteUser(authData.user.id)
      console.error('[finance-users POST] insert', insertError)
      return NextResponse.json(
        { error: insertError.message || 'Failed to save finance profile' },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true, user: row })
  } catch (e: any) {
    console.error('[finance-users POST]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
