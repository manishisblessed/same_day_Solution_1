/**
 * GET /api/admin/aeps/bank-settlements
 * Admin lists AEPS settlement-to-bank records from aeps_settlements table.
 * Query params: ?status=pending|processing|success|failed|reversed|all&limit=100
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    const statusFilter = searchParams.get('status') || 'pending'
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500)

    let query = supabase
      .from('aeps_settlements')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (statusFilter !== 'all') {
      if (statusFilter === 'pending') {
        query = query.in('status', ['pending', 'processing'])
      } else {
        query = query.eq('status', statusFilter)
      }
    }

    const { data: settlements, error } = await query

    if (error) {
      console.error('[Admin AEPS Bank Settlements] Query error:', error)
      return NextResponse.json({ error: 'Failed to fetch settlements' }, { status: 500 })
    }

    // Enrich with user info
    const userIds = [...new Set((settlements || []).map(s => s.user_id))]
    let usersMap: Record<string, any> = {}

    if (userIds.length > 0) {
      for (const table of ['retailers', 'distributors', 'master_distributors'] as const) {
        const { data: users } = await supabase
          .from(table)
          .select('partner_id, name, business_name, mobile, email')
          .in('partner_id', userIds)

        if (users) {
          for (const u of users) {
            usersMap[u.partner_id] = u
          }
        }
      }
    }

    const enriched = (settlements || []).map(s => ({
      ...s,
      user_info: usersMap[s.user_id] || null,
    }))

    return NextResponse.json({
      success: true,
      settlements: enriched,
      count: enriched.length,
    })
  } catch (error: any) {
    console.error('[Admin AEPS Bank Settlements] Error:', error)
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 })
  }
}
