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

const VALID_TABLES = ['retailers', 'distributors', 'master_distributors'] as const
type UserTable = typeof VALID_TABLES[number]

function isValidTable(t: string): t is UserTable {
  return (VALID_TABLES as readonly string[]).includes(t)
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
    if (!depts.includes('users')) return null
  }

  return { admin, adminData }
}

/**
 * POST - Create user (retailer/distributor/master_distributor) without auth account
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await checkAdminAuth(request)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    const { type, data } = await request.json()
    if (!type || !isValidTable(type)) {
      return NextResponse.json({ error: 'Invalid table type' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const { data: created, error } = await supabase.from(type).insert([data]).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    try {
      const ctx = getRequestContext(request)
      await logActivityFromContext(ctx, { id: auth.admin.id, role: auth.admin.role, email: auth.admin.email }, {
        activity_type: 'user_created',
        activity_category: 'admin',
        activity_description: `Created ${type.replace('_', ' ')}`,
        reference_id: created?.id,
        reference_table: type,
      })
    } catch {}

    return NextResponse.json({ success: true, data: created })
  } catch (err: any) {
    console.error('[Admin Users API] POST error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT - Update user
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await checkAdminAuth(request)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    const { type, id, data } = await request.json()
    if (!type || !isValidTable(type)) {
      return NextResponse.json({ error: 'Invalid table type' }, { status: 400 })
    }
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from(type).update(data).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    try {
      const ctx = getRequestContext(request)
      await logActivityFromContext(ctx, { id: auth.admin.id, role: auth.admin.role, email: auth.admin.email }, {
        activity_type: 'user_updated',
        activity_category: 'admin',
        activity_description: `Updated ${type.replace('_', ' ')}`,
        reference_id: id,
        reference_table: type,
      })
    } catch {}

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[Admin Users API] PUT error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE - Delete user(s)
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await checkAdminAuth(request)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    const { type, ids } = await request.json()
    if (!type || !isValidTable(type)) {
      return NextResponse.json({ error: 'Invalid table type' }, { status: 400 })
    }
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'Missing or empty ids array' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from(type).delete().in('id', ids)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    try {
      const ctx = getRequestContext(request)
      await logActivityFromContext(ctx, { id: auth.admin.id, role: auth.admin.role, email: auth.admin.email }, {
        activity_type: 'user_deleted',
        activity_category: 'admin',
        activity_description: `Deleted ${ids.length} ${type.replace('_', ' ')}`,
        metadata: { table: type, ids },
      })
    } catch {}

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[Admin Users API] DELETE error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
