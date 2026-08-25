import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { parentRoleOf } from '@/lib/hierarchy'

export const dynamic = 'force-dynamic'

/**
 * GET /api/onboarding/invite/parents?role=distributor|retailer
 * Returns active users one tier above the target role, for the admin parent
 * picker when creating an invite.
 *   distributor -> list of master_distributors
 *   retailer    -> list of distributors
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    if (user.role !== 'admin' && user.role !== 'finance_executive') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const targetRole = request.nextUrl.searchParams.get('role')?.trim() || ''
    const parentRole = parentRoleOf(targetRole)
    if (!parentRole) {
      return NextResponse.json({ success: true, parents: [] })
    }

    const table = parentRole === 'master_distributor' ? 'master_distributors' : 'distributors'
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from(table)
      .select('partner_id, name, business_name, email, status')
      .eq('status', 'active')
      .order('name', { ascending: true })
      .limit(500)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({
      success: true,
      parentRole,
      parents: (data || []).map((p: any) => ({
        partner_id: p.partner_id,
        name: p.name || p.business_name || p.partner_id,
        email: p.email,
      })),
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 })
  }
}
