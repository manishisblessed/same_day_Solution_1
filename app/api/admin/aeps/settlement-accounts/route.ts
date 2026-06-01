import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/aeps/settlement-accounts
 * Admin lists AEPS settlement accounts — filterable by admin_status.
 * Query params: ?status=pending_approval|approved|rejected|all (default: pending_approval)
 */
export async function GET(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { searchParams } = new URL(request.url)
    const statusFilter = searchParams.get('status') || 'pending_approval'

    let query = supabase
      .from('aeps_settlement_accounts')
      .select('*')
      .order('created_at', { ascending: false })

    if (statusFilter !== 'all') {
      query = query.eq('admin_status', statusFilter)
    }

    const { data: accounts, error } = await query

    if (error) {
      console.error('[Admin AEPS Settle Accounts] Query error:', error)
      return NextResponse.json({ success: true, accounts: [] })
    }

    // Enrich with user details
    const userIds = [...new Set((accounts || []).map(a => a.user_id))]
    let usersMap: Record<string, any> = {}

    if (userIds.length > 0) {
      const [{ data: retailers }, { data: distributors }, { data: mds }] = await Promise.all([
        supabase.from('retailers').select('partner_id, name, business_name, mobile, email').in('partner_id', userIds),
        supabase.from('distributors').select('partner_id, name, business_name, mobile, email').in('partner_id', userIds),
        supabase.from('master_distributors').select('partner_id, name, business_name, mobile, email').in('partner_id', userIds),
      ])

      for (const r of (retailers || [])) usersMap[r.partner_id] = { ...r, role: 'retailer' }
      for (const d of (distributors || [])) usersMap[d.partner_id] = { ...d, role: 'distributor' }
      for (const m of (mds || [])) usersMap[m.partner_id] = { ...m, role: 'master_distributor' }
    }

    const enriched = (accounts || []).map(a => ({
      ...a,
      user_info: usersMap[a.user_id] || null,
    }))

    return NextResponse.json({ success: true, accounts: enriched })
  } catch (err: any) {
    console.error('[Admin AEPS Settle Accounts] Error:', err)
    return NextResponse.json({ error: err.message || 'Failed to fetch accounts' }, { status: 500 })
  }
}
