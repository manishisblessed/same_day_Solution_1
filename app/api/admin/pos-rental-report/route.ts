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
  monthly_rate: number
  // For prorata calculation within the selected period
  billing_period_start: string   // e.g. "01-May-2026"
  billing_period_end: string     // e.g. "10-May-2026" (today) or "31-May-2026"
  billable_days: number          // days POS was active within this billing period
  total_prorata_amount: number
  status: string
  machines: {
    tid: string
    serial_number: string
    assigned_date: string
    return_date: string | null
    days_in_period: number       // days this machine was active in selected period
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

/**
 * Calculate days a POS was active within a specific billing period.
 * 
 * @param assignedDate - when POS was assigned to partner
 * @param returnDate - when POS was returned (null if still active)
 * @param periodStart - billing period start (e.g., May 1)
 * @param periodEnd - billing period end (e.g., May 10 or May 31)
 * @returns number of billable days within the period
 */
function calcDaysInPeriod(
  assignedDate: string,
  returnDate: string | null,
  periodStart: Date,
  periodEnd: Date
): number {
  const assigned = new Date(assignedDate)
  const returned = returnDate ? new Date(returnDate) : new Date() // if not returned, use today

  // Effective start = later of (assigned date, period start)
  const effectiveStart = assigned > periodStart ? assigned : periodStart
  
  // Effective end = earlier of (return date or today, period end)
  const effectiveEnd = returned < periodEnd ? returned : periodEnd

  // If the POS wasn't active during this period at all
  if (effectiveStart > effectiveEnd) return 0

  // Calculate days (inclusive of both start and end dates)
  const diffMs = effectiveEnd.getTime() - effectiveStart.getTime()
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1 // +1 for inclusive
  
  return Math.max(0, days)
}

export async function buildRentalData(
  supabase: any,
  period: string,
  filters: { dateFrom?: string | null; dateTo?: string | null; company?: string | null; partnerType?: string | null; status?: string | null; search?: string | null }
): Promise<PartnerRentalRow[]> {
  const { startDate, endDate } = getDateRange(period, filters.dateFrom || null, filters.dateTo || null)
  
  const periodStart = new Date(startDate)
  const periodEnd = new Date(endDate)
  periodStart.setHours(0, 0, 0, 0)
  periodEnd.setHours(23, 59, 59, 999)

  // For prorata billing, we need ALL assignments that overlap with the billing period:
  // 1. Assigned before/during period AND (not returned OR returned after period start)
  // This includes machines assigned before the month that are still active during it
  const { data: assignments, error } = await supabase
    .from('pos_assignment_history')
    .select('*')
    .lte('created_at', `${endDate}T23:59:59`) // assigned on or before period end
    .or(`returned_date.is.null,returned_date.gte.${startDate}`) // still active OR returned after period start
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

    // Calculate days this POS was active WITHIN the billing period
    const daysInPeriod = calcDaysInPeriod(assignment.created_at, assignment.returned_date, periodStart, periodEnd)
    
    // Skip if this POS had 0 days in the billing period
    if (daysInPeriod === 0) continue

    // Apply filters
    if (filters.company && info.companyName !== filters.company) continue
    if (filters.partnerType && info.partnerType !== filters.partnerType) continue
    if (filters.status && assignment.status !== filters.status) continue
    if (filters.search) {
      const sl = filters.search.toLowerCase()
      const tidMatch = pos.tid && pos.tid.toString().toLowerCase().includes(sl)
      const serialMatch = pos.serial_number && pos.serial_number.toString().toLowerCase().includes(sl)
      if (!info.companyName.toLowerCase().includes(sl) &&
          !info.partnerName.toLowerCase().includes(sl) &&
          !tidMatch &&
          !serialMatch) continue
    }

    // Prorata = (monthly_rate / 30) × days_in_this_period
    const prorataAmount = Math.round((info.monthlyRate / 30) * daysInPeriod * 100) / 100

    // Group by partnerKey
    if (!partnerMap[partnerKey]) {
      partnerMap[partnerKey] = {
        company_name: info.companyName,
        partner_name: info.partnerName,
        partner_type: info.partnerType,
        pos_count: 0,
        pos_tids: [],
        monthly_rate: info.monthlyRate,
        billing_period_start: startDate,
        billing_period_end: endDate,
        billable_days: 0,
        total_prorata_amount: 0,
        status: 'returned',
        machines: []
      }
    }

    const row = partnerMap[partnerKey]
    row.pos_count += 1
    if (pos.tid) row.pos_tids.push(String(pos.tid))
    row.billable_days += daysInPeriod
    row.total_prorata_amount = Math.round((row.total_prorata_amount + prorataAmount) * 100) / 100

    // If any machine is still active (within period), mark as active
    if (!assignment.returned_date || new Date(assignment.returned_date) > periodEnd) {
      row.status = 'active'
    }

    row.machines.push({
      tid: pos.tid ? String(pos.tid) : '',
      serial_number: pos.serial_number || '',
      assigned_date: assignment.created_at,
      return_date: assignment.returned_date,
      days_in_period: daysInPeriod,
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
      company: period === 'all_history' ? sp.get('company') : null,
      partnerType: period === 'all_history' ? sp.get('partnerType') : null,
      status: period === 'all_history' ? sp.get('status') : null,
      search: sp.get('search')   // works on all tabs
    })

    const total = allData.length
    const paginatedData = allData.slice((page - 1) * limit, page * limit)

    const stats = {
      totalPOS: allData.reduce((s, r) => s + r.pos_count, 0),
      totalBillableDays: allData.reduce((s, r) => s + r.billable_days, 0),
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
