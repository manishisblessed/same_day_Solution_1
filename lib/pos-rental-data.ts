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

async function batchFetchIn<T>(
  supabase: any,
  table: string,
  column: string,
  ids: string[],
  selectCols: string
): Promise<T[]> {
  if (ids.length === 0) return []
  const CHUNK = 500
  const results: T[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const { data } = await supabase.from(table).select(selectCols).in(column, chunk)
    if (data) results.push(...data)
  }
  return results
}

function toMap<T>(items: T[], keyFn: (item: T) => string): Record<string, T> {
  const map: Record<string, T> = {}
  for (const item of items) {
    map[keyFn(item)] = item
  }
  return map
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

  // --- Batch-load all POS machines ---
  const machineIds = [...new Set(assignments.map((a: any) => a.pos_machine_id))] as string[]
  const machinesRaw: any[] = await batchFetchIn(
    supabase, 'pos_machines', 'id', machineIds,
    'id, tid, serial_number, retailer_id, distributor_id, master_distributor_id, partner_id'
  )
  const posMap = toMap(machinesRaw, (m: any) => m.id)

  // --- Collect all unique partner IDs by type ---
  const retailerIds = new Set<string>()
  const distributorIds = new Set<string>()
  const mdIds = new Set<string>()
  const partnerIds = new Set<string>()

  for (const pos of machinesRaw) {
    if (pos.retailer_id) retailerIds.add(pos.retailer_id)
    if (pos.distributor_id) distributorIds.add(pos.distributor_id)
    if (pos.master_distributor_id) mdIds.add(pos.master_distributor_id)
    if (pos.partner_id) partnerIds.add(pos.partner_id)
  }

  // --- Batch-load partner details & subscriptions in parallel ---
  const allUserIds = [...retailerIds, ...distributorIds, ...mdIds, ...partnerIds]

  const [retailers, distributors, masterDists, partners, subscriptions] = await Promise.all([
    batchFetchIn<any>(supabase, 'retailers', 'partner_id', [...retailerIds], 'partner_id, name, business_name'),
    batchFetchIn<any>(supabase, 'distributors', 'partner_id', [...distributorIds], 'partner_id, name, business_name'),
    batchFetchIn<any>(supabase, 'master_distributors', 'partner_id', [...mdIds], 'partner_id, name, business_name'),
    batchFetchIn<any>(supabase, 'partners', 'id', [...partnerIds], 'id, name, business_name'),
    batchFetchIn<any>(supabase, 'subscriptions', 'user_id', allUserIds, 'id, user_id, user_role'),
  ])

  const retailerMap = toMap(retailers, (r: any) => r.partner_id)
  const distributorMap = toMap(distributors, (d: any) => d.partner_id)
  const mdMap = toMap(masterDists, (m: any) => m.partner_id)
  const partnerMap_raw = toMap(partners, (p: any) => p.id)

  const subByUser: Record<string, any> = {}
  for (const sub of subscriptions) {
    subByUser[sub.user_id] = sub
  }

  // --- Batch-load subscription items for all subscriptions ---
  const subIds = subscriptions.map((s: any) => s.id)
  const subItems: any[] = await batchFetchIn(
    supabase, 'subscription_items', 'subscription_id', subIds,
    'subscription_id, retailer_rate, distributor_rate, md_rate, is_active'
  )
  const activeItemBySub: Record<string, any> = {}
  for (const item of subItems) {
    if (item.is_active) activeItemBySub[item.subscription_id] = item
  }

  // --- Helper to resolve partner info from cache ---
  function resolvePartner(pos: any): { companyName: string; partnerName: string; partnerType: string; monthlyRate: number } {
    let companyName = ''
    let partnerName = ''
    let partnerType = ''
    let monthlyRate = 500

    const getRate = (userId: string, rateField: string): number => {
      const sub = subByUser[userId]
      if (!sub) return 500
      const item = activeItemBySub[sub.id]
      return item?.[rateField] || 500
    }

    if (pos.retailer_id) {
      const r = retailerMap[pos.retailer_id]
      partnerName = r?.name || pos.retailer_id
      companyName = r?.business_name || r?.name || 'Unknown'
      partnerType = 'Retailer'
      monthlyRate = getRate(pos.retailer_id, 'retailer_rate')
    } else if (pos.distributor_id) {
      const d = distributorMap[pos.distributor_id]
      partnerName = d?.name || pos.distributor_id
      companyName = d?.business_name || d?.name || 'Unknown'
      partnerType = 'Distributor'
      monthlyRate = getRate(pos.distributor_id, 'distributor_rate')
    } else if (pos.master_distributor_id) {
      const md = mdMap[pos.master_distributor_id]
      partnerName = md?.name || pos.master_distributor_id
      companyName = md?.business_name || md?.name || 'Unknown'
      partnerType = 'Master Distributor'
      monthlyRate = getRate(pos.master_distributor_id, 'md_rate')
    } else if (pos.partner_id) {
      const p = partnerMap_raw[pos.partner_id]
      partnerName = p?.name || pos.partner_id
      companyName = p?.business_name || p?.name || 'Unknown'
      partnerType = 'Partner'
      monthlyRate = getRate(pos.partner_id, 'retailer_rate')
    }

    return { companyName, partnerName, partnerType, monthlyRate }
  }

  // --- Build the rental rows ---
  const partnerMap: Record<string, PartnerRentalRow> = {}

  for (const assignment of assignments) {
    const pos = posMap[assignment.pos_machine_id]
    if (!pos) continue

    const partnerKey = pos.retailer_id || pos.distributor_id || pos.master_distributor_id || pos.partner_id || 'unknown'
    const info = resolvePartner(pos)

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
