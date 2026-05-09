import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RentalData {
  month: string
  company_name: string
  partner_name: string
  partner_type: string
  pos_count: number
  pos_tids: string[]
  monthly_rate: number
  assigned_date: string
  return_date: string | null
  rental_days: number
  prorata_amount: number
  status: string
}

async function enrichAssignmentWithDetails(
  supabase: any,
  assignment: any,
  pos: any
): Promise<RentalData | null> {
  let companyName = ''
  let partnerName = ''
  let partnerType = ''

  if (pos.retailer_id) {
    const { data: retailer } = await supabase
      .from('retailers')
      .select('name, business_name')
      .eq('partner_id', pos.retailer_id)
      .maybeSingle()
    partnerName = retailer?.name || pos.retailer_id
    companyName = retailer?.business_name || retailer?.name || 'Unknown'
    partnerType = 'Retailer'
  } else if (pos.distributor_id) {
    const { data: dist } = await supabase
      .from('distributors')
      .select('name, business_name')
      .eq('partner_id', pos.distributor_id)
      .maybeSingle()
    partnerName = dist?.name || pos.distributor_id
    companyName = dist?.business_name || dist?.name || 'Unknown'
    partnerType = 'Distributor'
  } else if (pos.master_distributor_id) {
    const { data: md } = await supabase
      .from('master_distributors')
      .select('name, business_name')
      .eq('partner_id', pos.master_distributor_id)
      .maybeSingle()
    partnerName = md?.name || pos.master_distributor_id
    companyName = md?.business_name || md?.name || 'Unknown'
    partnerType = 'Master Distributor'
  } else if (pos.partner_id) {
    const { data: partner } = await supabase
      .from('partners')
      .select('name, business_name')
      .eq('id', pos.partner_id)
      .maybeSingle()
    partnerName = partner?.name || pos.partner_id
    companyName = partner?.business_name || partner?.name || 'Unknown'
    partnerType = 'Partner'
  }

  // Get subscription rate
  let monthlyRate = 500
  if (pos.retailer_id) {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('user_id', pos.retailer_id)
      .eq('user_role', 'retailer')
      .maybeSingle()

    if (sub) {
      const { data: item } = await supabase
        .from('subscription_items')
        .select('retailer_rate')
        .eq('subscription_id', sub.id)
        .eq('is_active', true)
        .maybeSingle()

      if (item?.retailer_rate) monthlyRate = item.retailer_rate
    }
  }

  const rentalDays = assignment.returned_date
    ? Math.floor((new Date(assignment.returned_date).getTime() - new Date(assignment.created_at).getTime()) / (1000 * 60 * 60 * 24))
    : Math.floor((new Date().getTime() - new Date(assignment.created_at).getTime()) / (1000 * 60 * 60 * 24))

  const prorataAmount = (monthlyRate / 30) * rentalDays

  return {
    month: new Date(assignment.created_at).toISOString().split('T')[0].substring(0, 7),
    company_name: companyName,
    partner_name: partnerName,
    partner_type: partnerType,
    pos_count: 1,
    pos_tids: pos.tid ? [pos.tid] : [],
    monthly_rate: monthlyRate,
    assigned_date: assignment.created_at,
    return_date: assignment.returned_date,
    rental_days: rentalDays,
    prorata_amount: Math.round(prorataAmount * 100) / 100,
    status: assignment.status
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Supabase configuration missing' },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { user: admin } = await getCurrentUserWithFallback(request)

    if (!admin) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const period = searchParams.get('period') || 'current_month'
    const page = parseInt(searchParams.get('page') || '1')
    const limit = 25

    // Date filters
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const company = searchParams.get('company')
    const partnerType = searchParams.get('partnerType')
    const status = searchParams.get('status')
    const search = searchParams.get('search')

    let startDate: string, endDate: string
    const today = new Date()
    const currentYear = today.getFullYear()
    const currentMonth = today.getMonth()

    if (period === 'current_month') {
      startDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`
      endDate = today.toISOString().split('T')[0]
    } else if (period === 'last_month') {
      const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1
      const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear
      startDate = `${lastMonthYear}-${String(lastMonth + 1).padStart(2, '0')}-01`
      const lastDay = new Date(lastMonthYear, lastMonth + 1, 0)
      endDate = lastDay.toISOString().split('T')[0]
    } else {
      startDate = dateFrom || '2024-01-01'
      endDate = dateTo || today.toISOString().split('T')[0]
    }

    // Fetch assignments
    let query = supabase
      .from('pos_assignment_history')
      .select('*')
      .gte('created_at', `${startDate}T00:00:00`)
      .lte('created_at', `${endDate}T23:59:59`)
      .order('created_at', { ascending: false })

    const { data: assignments, error } = await query

    if (error) {
      console.error('Error fetching assignments:', error)
      throw error
    }

    const enrichedData: RentalData[] = []

    if (assignments) {
      for (const assignment of assignments) {
        const { data: pos } = await supabase
          .from('pos_machines')
          .select('*')
          .eq('id', assignment.pos_machine_id)
          .maybeSingle()

        if (!pos) continue

        const enriched = await enrichAssignmentWithDetails(supabase, assignment, pos)
        if (!enriched) continue

        // Apply filters
        if (period === 'all_history') {
          if (company && enriched.company_name !== company) continue
          if (partnerType && enriched.partner_type !== partnerType) continue
          if (status && enriched.status !== status) continue
          if (search) {
            const searchLower = search.toLowerCase()
            if (!enriched.company_name.toLowerCase().includes(searchLower) &&
                !enriched.partner_name.toLowerCase().includes(searchLower) &&
                !enriched.pos_tids.some(tid => tid.includes(search))) {
              continue
            }
          }
        }

        enrichedData.push(enriched)
      }
    }

    // Paginate
    const total = enrichedData.length
    const start = (page - 1) * limit
    const paginatedData = enrichedData.slice(start, start + limit)

    // Calculate stats
    const stats = {
      totalPOS: enrichedData.length,
      totalDays: enrichedData.reduce((sum, r) => sum + r.rental_days, 0),
      totalRevenue: Math.round(enrichedData.reduce((sum, r) => sum + r.prorata_amount, 0) * 100) / 100
    }

    return NextResponse.json({
      success: true,
      data: paginatedData,
      stats,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    })
  } catch (error: any) {
    console.error('Error in pos-rental-report API:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
