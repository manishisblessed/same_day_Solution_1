import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface PartnerRentalRow {
  company_name: string
  partner_name: string
  partner_type: string
  pos_count: number
  pos_tids: string[]
  monthly_rate: number           // rate per machine per month
  earliest_assigned_date: string // earliest assignment date
  latest_return_date: string | null // null if any POS still active
  total_rental_days: number      // sum of rental days across all machines
  total_prorata_amount: number   // sum of prorata amounts
  status: string                 // 'active' if any POS still active, else 'returned'
  // per-machine detail
  machines: {
    tid: string
    serial_number: string
    assigned_date: string
    return_date: string | null
    rental_days: number
    prorata_amount: number
    machine_status: string
  }[]
}

function getDateRange(period: string, dateFrom: string | null, dateTo: string | null) {
  const today = new Date()
  const currentYear = today.getFullYear()
  const currentMonth = today.getMonth()

  if (period === 'current_month') {
    return {
      startDate: `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`,
      endDate: today.toISOString().split('T')[0]
    }
  } else if (period === 'last_month') {
    const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1
    const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear
    const lastDay = new Date(lastMonthYear, lastMonth + 1, 0)
    return {
      startDate: `${lastMonthYear}-${String(lastMonth + 1).padStart(2, '0')}-01`,
      endDate: lastDay.toISOString().split('T')[0]
    }
  } else {
    return {
      startDate: dateFrom || '2024-01-01',
      endDate: dateTo || today.toISOString().split('T')[0]
    }
  }
}

function calcRentalDays(assignedDate: string, returnDate: string | null): number {
  const end = returnDate ? new Date(returnDate) : new Date()
  const start = new Date(assignedDate)
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))
}

export async function buildRentalData(
  supabase: any,
  period: string,
  filters: { dateFrom?: string | null; dateTo?: string | null; company?: string | null; partnerType?: string | null; status?: string | null; search?: string | null }
): Promise<PartnerRentalRow[]> {
  const { startDate, endDate } = getDateRange(period, filters.dateFrom || null, filters.dateTo || null)

  // Fetch all assignments in date range
  const { data: assignments, error } = await supabase
    .from('pos_assignment_history')
    .select('*')
    .gte('created_at', `${startDate}T00:00:00`)
    .lte('created_at', `${endDate}T23:59:59`)
    .order('created_at', { ascending: false })

  if (error) throw error
  if (!assignments || assignments.length === 0) return []

  // Cache partner lookups to avoid redundant DB calls
  const partnerCache: Record<string, { companyName: string; partnerName: string; partnerType: string; monthlyRate: number }> = {}
  const posCache: Record<string, any> = {}

  // Map: partnerKey → aggregated row
  const partnerMap: Record<string, PartnerRentalRow> = {}

  for (const assignment of assignments) {
    // Get POS machine (with cache)
    let pos = posCache[assignment.pos_machine_id]
    if (!pos) {
      const { data } = await supabase
        .from('pos_machines')
        .select('id, tid, serial_number, retailer_id, distributor_id, master_distributor_id, partner_id')
        .eq('id', assignment.pos_machine_id)
        .maybeSingle()
      if (!data) continue
      pos = data
      posCache[assignment.pos_machine_id] = pos
    }

    // Determine partner key for caching
    const partnerKey = pos.retailer_id || pos.distributor_id || pos.master_distributor_id || pos.partner_id || 'unknown'

    let info = partnerCache[partnerKey]
    if (!info) {
      let companyName = ''
      let partnerName = ''
      let partnerType = ''
      let monthlyRate = 500

      if (pos.retailer_id) {
        const { data: r } = await supabase.from('retailers').select('name, business_name').eq('partner_id', pos.retailer_id).maybeSingle()
        partnerName = r?.name || pos.retailer_id
        companyName = r?.business_name || r?.name || 'Unknown'
        partnerType = 'Retailer'
        // Get subscription rate
        const { data: sub } = await supabase.from('subscriptions').select('id').eq('user_id', pos.retailer_id).eq('user_role', 'retailer').maybeSingle()
        if (sub) {
          const { data: item } = await supabase.from('subscription_items').select('retailer_rate').eq('subscription_id', sub.id).eq('is_active', true).maybeSingle()
          if (item?.retailer_rate) monthlyRate = item.retailer_rate
        }
      } else if (pos.distributor_id) {
        const { data: d } = await supabase.from('distributors').select('name, business_name').eq('partner_id', pos.distributor_id).maybeSingle()
        partnerName = d?.name || pos.distributor_id
        companyName = d?.business_name || d?.name || 'Unknown'
        partnerType = 'Distributor'
        const { data: sub } = await supabase.from('subscriptions').select('id').eq('user_id', pos.distributor_id).eq('user_role', 'distributor').maybeSingle()
        if (sub) {
          const { data: item } = await supabase.from('subscription_items').select('distributor_rate').eq('subscription_id', sub.id).eq('is_active', true).maybeSingle()
          if (item?.distributor_rate) monthlyRate = item.distributor_rate
        }
      } else if (pos.master_distributor_id) {
        const { data: md } = await supabase.from('master_distributors').select('name, business_name').eq('partner_id', pos.master_distributor_id).maybeSingle()
        partnerName = md?.name || pos.master_distributor_id
        companyName = md?.business_name || md?.name || 'Unknown'
        partnerType = 'Master Distributor'
        const { data: sub } = await supabase.from('subscriptions').select('id').eq('user_id', pos.master_distributor_id).eq('user_role', 'master_distributor').maybeSingle()
        if (sub) {
          const { data: item } = await supabase.from('subscription_items').select('md_rate').eq('subscription_id', sub.id).eq('is_active', true).maybeSingle()
          if (item?.md_rate) monthlyRate = item.md_rate
        }
      } else if (pos.partner_id) {
        const { data: p } = await supabase.from('partners').select('name, business_name').eq('id', pos.partner_id).maybeSingle()
        partnerName = p?.name || pos.partner_id
        companyName = p?.business_name || p?.name || 'Unknown'
        partnerType = 'Partner'
        const { data: sub } = await supabase.from('subscriptions').select('id').eq('user_id', pos.partner_id).maybeSingle()
        if (sub) {
          const { data: item } = await supabase.from('subscription_items').select('retailer_rate').eq('subscription_id', sub.id).eq('is_active', true).maybeSingle()
          if (item?.retailer_rate) monthlyRate = item.retailer_rate
        }
      }

      info = { companyName, partnerName, partnerType, monthlyRate }
      partnerCache[partnerKey] = info
    }

    // Apply filters
    if (filters.company && info.companyName !== filters.company) continue
    if (filters.partnerType && info.partnerType !== filters.partnerType) continue
    if (filters.status && assignment.status !== filters.status) continue
    if (filters.search) {
      const sl = filters.search.toLowerCase()
      const tidMatch = pos.tid && pos.tid.toString().includes(filters.search)
      if (!info.companyName.toLowerCase().includes(sl) &&
          !info.partnerName.toLowerCase().includes(sl) &&
          !tidMatch) continue
    }

    const rentalDays = calcRentalDays(assignment.created_at, assignment.returned_date)
    const prorataAmount = Math.round((info.monthlyRate / 30) * rentalDays * 100) / 100

    // Group by partnerKey
    if (!partnerMap[partnerKey]) {
      partnerMap[partnerKey] = {
        company_name: info.companyName,
        partner_name: info.partnerName,
        partner_type: info.partnerType,
        pos_count: 0,
        pos_tids: [],
        monthly_rate: info.monthlyRate,
        earliest_assigned_date: assignment.created_at,
        latest_return_date: assignment.returned_date,
        total_rental_days: 0,
        total_prorata_amount: 0,
        status: 'returned',
        machines: []
      }
    }

    const row = partnerMap[partnerKey]
    row.pos_count += 1
    if (pos.tid) row.pos_tids.push(String(pos.tid))
    row.total_rental_days += rentalDays
    row.total_prorata_amount = Math.round((row.total_prorata_amount + prorataAmount) * 100) / 100

    // Track earliest assigned date
    if (new Date(assignment.created_at) < new Date(row.earliest_assigned_date)) {
      row.earliest_assigned_date = assignment.created_at
    }

    // If any machine is still active, the overall status is active
    if (!assignment.returned_date) {
      row.status = 'active'
      row.latest_return_date = null
    } else if (row.status !== 'active' && assignment.returned_date) {
      // Track latest return date
      if (!row.latest_return_date || new Date(assignment.returned_date) > new Date(row.latest_return_date)) {
        row.latest_return_date = assignment.returned_date
      }
    }

    row.machines.push({
      tid: pos.tid ? String(pos.tid) : '',
      serial_number: pos.serial_number || '',
      assigned_date: assignment.created_at,
      return_date: assignment.returned_date,
      rental_days: rentalDays,
      prorata_amount: prorataAmount,
      machine_status: assignment.status
    })
  }

  // Sort by company name then partner name
  return Object.values(partnerMap).sort((a, b) => {
    const c = a.company_name.localeCompare(b.company_name)
    return c !== 0 ? c : a.partner_name.localeCompare(b.partner_name)
  })
}

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
      company: sp.get('company'),
      partnerType: sp.get('partnerType'),
      status: sp.get('status'),
      search: sp.get('search')
    })

    const total = allData.length
    const paginatedData = allData.slice((page - 1) * limit, page * limit)

    const stats = {
      totalPOS: allData.reduce((s, r) => s + r.pos_count, 0),
      totalDays: allData.reduce((s, r) => s + r.total_rental_days, 0),
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
