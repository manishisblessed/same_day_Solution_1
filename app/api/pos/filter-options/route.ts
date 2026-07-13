import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/pos/filter-options
 * Returns retailer/distributor options for transaction filter dropdowns.
 * - Distributor → gets their retailers
 * - Master Distributor → gets their distributors + retailers
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || !user.partner_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getSupabaseAdmin()

    if (user.role === 'distributor') {
      const { data: retailers } = await supabase
        .from('retailers')
        .select('partner_id, name, business_name')
        .eq('distributor_id', user.partner_id)
        .order('name')

      return NextResponse.json({
        retailers: (retailers || []).map(r => ({
          id: r.partner_id,
          name: r.business_name || r.name || r.partner_id
        }))
      })
    }

    if (user.role === 'master_distributor') {
      const [{ data: distributors }, { data: retailers }] = await Promise.all([
        supabase
          .from('distributors')
          .select('partner_id, name, business_name')
          .eq('master_distributor_id', user.partner_id)
          .order('name'),
        supabase
          .from('retailers')
          .select('partner_id, name, business_name, distributor_id')
          .eq('master_distributor_id', user.partner_id)
          .order('name')
      ])

      return NextResponse.json({
        distributors: (distributors || []).map(d => ({
          id: d.partner_id,
          name: d.business_name || d.name || d.partner_id
        })),
        retailers: (retailers || []).map(r => ({
          id: r.partner_id,
          name: r.business_name || r.name || r.partner_id
        }))
      })
    }

    return NextResponse.json({ retailers: [], distributors: [] })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
