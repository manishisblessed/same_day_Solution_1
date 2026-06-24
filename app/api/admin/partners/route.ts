import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

export const dynamic = 'force-dynamic'

let _supabase: SupabaseClient | null = null
function getSupabaseAdmin(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Supabase environment variables not configured')
    _supabase = createClient(url, key)
  }
  return _supabase
}

async function checkAdminAuth(request: NextRequest) {
  const { user: admin } = await getCurrentUserWithFallback(request)
  if (!admin || admin.role !== 'admin') return null

  const supabase = getSupabaseAdmin()
  const { data: adminData } = await supabase
    .from('admin_users')
    .select('id, admin_type, department, departments, is_active')
    .eq('email', admin.email)
    .single()

  if (!adminData || adminData.is_active === false) return null

  if (adminData.admin_type === 'sub_admin') {
    const depts: string[] = adminData.departments || (adminData.department ? [adminData.department] : [])
    if (!depts.includes('partners') && !depts.includes('users')) return null
  }

  return { admin, adminData }
}

/**
 * POST - Create partner
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await checkAdminAuth(request)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    const { data } = await request.json()
    if (!data) return NextResponse.json({ error: 'Missing data' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const { data: created, error } = await supabase.from('partners').insert([data]).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    try {
      const ctx = getRequestContext(request)
      await logActivityFromContext(ctx, { id: auth.admin.id, role: auth.admin.role, email: auth.admin.email }, {
        activity_type: 'partner_created',
        activity_category: 'admin',
        activity_description: `Created partner ${data.name || ''}`,
        reference_id: created?.id,
        reference_table: 'partners',
      })
    } catch {}

    return NextResponse.json({ success: true, data: created })
  } catch (err: any) {
    console.error('[Admin Partners API] POST error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT - Update partner
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await checkAdminAuth(request)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    const { id, data } = await request.json()
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from('partners').update(data).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    try {
      const ctx = getRequestContext(request)
      await logActivityFromContext(ctx, { id: auth.admin.id, role: auth.admin.role, email: auth.admin.email }, {
        activity_type: 'partner_updated',
        activity_category: 'admin',
        activity_description: 'Updated partner',
        reference_id: id,
        reference_table: 'partners',
      })
    } catch {}

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[Admin Partners API] PUT error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE - Delete partner (cleanup on failed auth user creation)
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await checkAdminAuth(request)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    const { id } = await request.json()
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from('partners').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    try {
      const ctx = getRequestContext(request)
      await logActivityFromContext(ctx, { id: auth.admin.id, role: auth.admin.role, email: auth.admin.email }, {
        activity_type: 'partner_deleted',
        activity_category: 'admin',
        activity_description: 'Deleted partner',
        reference_id: id,
        reference_table: 'partners',
      })
    } catch {}

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[Admin Partners API] DELETE error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
