export interface PartnerRentalRow {
  company_name: string
  partner_name: string
  partner_type: string
  pos_count: number
  pos_tids: string[]
  monthly_rate: number
  total_prorata_amount: number
  status: string
  machines: {
    tid: string
    serial_number: string
    assigned_date: string
    return_date: string | null
    days_in_period: number
    prorata_amount: number
    machine_status: string
  }[]
}

export function getDateRange(period: string, dateFrom: string | null, dateTo: string | null) {
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

function calcDaysInPeriod(
  assignedDate: string,
  returnDate: string | null,
  periodStart: Date,
  periodEnd: Date
): number {
  const assigned = new Date(assignedDate)
  const returned = returnDate ? new Date(returnDate) : new Date()

  const effectiveStart = assigned > periodStart ? assigned : periodStart
  const effectiveEnd = returned < periodEnd ? returned : periodEnd

  if (effectiveStart > effectiveEnd) return 0

  const diffMs = effectiveEnd.getTime() - effectiveStart.getTime()
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1
  
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

  const { data: assignments, error } = await supabase
    .from('pos_assignment_history')
    .select('*')
    .lte('created_at', `${endDate}T23:59:59`)
    .or(`returned_date.is.null,returned_date.gte.${startDate}`)
    .order('created_at', { ascending: false })

  if (error) throw error
  if (!assignments || assignments.length === 0) return []

  const partnerCache: Record<string, { companyName: string; partnerName: string; partnerType: string; monthlyRate: number }> = {}
  const posCache: Record<string, any> = {}
  const partnerMap: Record<string, PartnerRentalRow> = {}

  for (const assignment of assignments) {
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

    const daysInPeriod = calcDaysInPeriod(assignment.created_at, assignment.returned_date, periodStart, periodEnd)
    if (daysInPeriod === 0) continue

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

    const prorataAmount = Math.round((info.monthlyRate / 30) * daysInPeriod * 100) / 100

    if (!partnerMap[partnerKey]) {
      partnerMap[partnerKey] = {
        company_name: info.companyName,
        partner_name: info.partnerName,
        partner_type: info.partnerType,
        pos_count: 0,
        pos_tids: [],
        monthly_rate: info.monthlyRate,
        total_prorata_amount: 0,
        status: 'returned',
        machines: []
      }
    }

    const row = partnerMap[partnerKey]
    row.pos_count += 1
    if (pos.tid) row.pos_tids.push(String(pos.tid))
    row.total_prorata_amount = Math.round((row.total_prorata_amount + prorataAmount) * 100) / 100

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

  return Object.values(partnerMap).sort((a, b) => {
    const c = a.company_name.localeCompare(b.company_name)
    return c !== 0 ? c : a.partner_name.localeCompare(b.partner_name)
  })
}
