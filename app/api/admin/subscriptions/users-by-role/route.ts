import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/subscriptions/users-by-role?role=master_distributor|distributor|retailer
 * Returns all users for the given role (partner_id, name) for admin dropdowns.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const url = new URL(request.url)
    const role = url.searchParams.get('role')?.toLowerCase()
    if (!role || !['partner', 'master_partner', 'master_distributor', 'distributor', 'retailer'].includes(role)) {
      return NextResponse.json({ error: 'role must be partner, master_partner, master_distributor, distributor, or retailer' }, { status: 400 })
    }

    const isPartnersTable = role === 'partner' || role === 'master_partner'
    const table = isPartnersTable ? 'partners' : role === 'master_distributor' ? 'master_distributors' : role === 'distributor' ? 'distributors' : 'retailers'
    // partners PK is `id`; other role tables key on `partner_id`.
    const idField = isPartnersTable ? 'id' : 'partner_id'

    let query = supabaseAdmin.from(table).select(`${idField}, name`).order('name')
    // partner and master_partner share the partners table — keep the groups distinct.
    if (role === 'partner') query = query.eq('is_master_partner', false)
    else if (role === 'master_partner') query = query.eq('is_master_partner', true)

    const { data, error } = await query

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const users = (data || []).map((row: any) => ({
      partner_id: row[idField],
      name: row.name || row[idField],
    }))

    return NextResponse.json({ users })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
