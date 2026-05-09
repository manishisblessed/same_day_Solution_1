import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { buildRentalData } from '@/lib/pos-rental-data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { user: admin } = await getCurrentUserWithFallback(request)

    if (!admin) return NextResponse.json({ error: 'Session expired.', code: 'SESSION_EXPIRED' }, { status: 401 })
    if (admin.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    const sp = request.nextUrl.searchParams
    const period = sp.get('period') || 'current_month'
    const page = parseInt(sp.get('page') || '1')
    const limit = 25

    const allData = await buildRentalData(supabase, period, {
      dateFrom: sp.get('dateFrom'),
      dateTo: sp.get('dateTo'),
      company: period === 'all_history' ? sp.get('company') : null,
      partnerType: period === 'all_history' ? sp.get('partnerType') : null,
      status: period === 'all_history' ? sp.get('status') : null,
      search: sp.get('search')
    })

    const total = allData.length
    const paginatedData = allData.slice((page - 1) * limit, page * limit)

    const totalPOS = allData.reduce((s, r) => s + r.pos_count, 0)
    const allMachines = allData.flatMap(r => r.machines)
    const totalDaysAllMachines = allMachines.reduce((s, m) => s + m.days_in_period, 0)
    const stats = {
      totalPOS,
      avgDaysPerPOS: totalPOS > 0 ? Math.round((totalDaysAllMachines / totalPOS) * 10) / 10 : 0,
      activePOS: allMachines.filter(m => m.machine_status === 'active').length,
      totalRevenue: Math.round(allData.reduce((s, r) => s + r.total_prorata_amount, 0) * 100) / 100
    }

    return NextResponse.json({
      success: true,
      data: paginatedData,
      stats,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    })
  } catch (error: any) {
    console.error('Error in pos-rental-report:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
