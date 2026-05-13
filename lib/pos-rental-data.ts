export interface PartnerRentalRow {
  company_name: string
  partner_name: string
  partner_type: string
  pos_count: number
  pos_tids: string[]
  monthly_rate: number
  monthly_rate_display: string
  has_plan: boolean
  total_prorata_amount: number
  status: string
  machines: {
    tid: string
    serial_number: string
    assigned_date: string
    return_date: string | null
    days_in_period: number
    prorata_amount: number
    monthly_rate: number
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

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

function toISTDate(d: Date): Date {
  const utc = d.getTime() + d.getTimezoneOffset() * 60000
  return new Date(utc + IST_OFFSET_MS)
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

  const startIST = toISTDate(effectiveStart)
  const endIST = toISTDate(effectiveEnd)
  const startDay = new Date(startIST.getFullYear(), startIST.getMonth(), startIST.getDate())
  const endDay = new Date(endIST.getFullYear(), endIST.getMonth(), endIST.getDate())
  const diffDays = Math.round((endDay.getTime() - startDay.getTime()) / (1000 * 60 * 60 * 24))

  return Math.max(0, diffDays)
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

async function fetchAllAssignments(
  supabase: any,
  endDate: string,
  startDate: string
): Promise<any[]> {
  const PAGE_SIZE = 1000
  const all: any[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('pos_assignment_history')
      .select('*')
      .like('action', 'assigned_to_%')
      .lte('created_at', `${endDate}T23:59:59`)
      .or(`returned_date.is.null,returned_date.gte.${startDate}`)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return all
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

  const assignments = await fetchAllAssignments(supabase, endDate, startDate)
  if (assignments.length === 0) return []

  const machineIds = [...new Set(assignments.map((a: any) => a.pos_machine_id))] as string[]
  const machinesRaw: any[] = await batchFetchIn(
    supabase, 'pos_machines', 'id', machineIds,
    'id, tid, serial_number, retailer_id, distributor_id, master_distributor_id, partner_id'
  )
  const posMap = toMap(machinesRaw, (m: any) => m.id)

  const distributorIds = new Set<string>()
  const mdIds = new Set<string>()
  const partnerIds = new Set<string>()

  for (const a of assignments) {
    if (!a.assigned_to) continue
    const role = (a.assigned_to_role || '').toLowerCase()
    if (role === 'retailer') continue
    if (role === 'distributor') distributorIds.add(a.assigned_to)
    else if (role === 'master_distributor') mdIds.add(a.assigned_to)
    else if (role === 'partner') partnerIds.add(a.assigned_to)
  }

  const allUserIds = [...distributorIds, ...mdIds, ...partnerIds]

  const [distributors, masterDists, partners, subscriptions] = await Promise.all([
    batchFetchIn<any>(supabase, 'distributors', 'partner_id', [...distributorIds], 'partner_id, name, business_name'),
    batchFetchIn<any>(supabase, 'master_distributors', 'partner_id', [...mdIds], 'partner_id, name, business_name'),
    batchFetchIn<any>(supabase, 'partners', 'id', [...partnerIds], 'id, name, business_name'),
    batchFetchIn<any>(supabase, 'subscriptions', 'user_id', allUserIds, 'id, user_id, user_role'),
  ])

  const distributorMap = toMap(distributors, (d: any) => d.partner_id)
  const mdMap = toMap(masterDists, (m: any) => m.partner_id)
  const partnerMap_raw = toMap(partners, (p: any) => p.id)

  const subByUser: Record<string, any> = {}
  for (const sub of subscriptions) {
    subByUser[sub.user_id] = sub
  }

  const subIds = subscriptions.map((s: any) => s.id)
  const subItems: any[] = await batchFetchIn(
    supabase, 'subscription_items', 'subscription_id', subIds,
    'subscription_id, retailer_rate, distributor_rate, md_rate, is_active'
  )
  const activeItemBySub: Record<string, any> = {}
  for (const item of subItems) {
    if (item.is_active) activeItemBySub[item.subscription_id] = item
  }

  function resolvePartnerFromAssignment(assignment: any): { companyName: string; partnerName: string; partnerType: string; monthlyRate: number; hasPlan: boolean } | null {
    const assignedTo = assignment.assigned_to
    const role = (assignment.assigned_to_role || '').toLowerCase()

    if (!assignedTo || role === 'retailer') return null

    const getRate = (userId: string, rateField: string): { rate: number; hasPlan: boolean } => {
      const sub = subByUser[userId]
      if (!sub) return { rate: 0, hasPlan: false }
      const item = activeItemBySub[sub.id]
      if (!item) return { rate: 0, hasPlan: false }
      return { rate: item[rateField] || 0, hasPlan: true }
    }

    let companyName = ''
    let partnerName = ''
    let partnerType = ''
    let monthlyRate = 0
    let hasPlan = false

    if (role === 'distributor') {
      const d = distributorMap[assignedTo]
      partnerName = d?.name || assignedTo
      companyName = d?.business_name || d?.name || 'Unknown'
      partnerType = 'Distributor'
      const r = getRate(assignedTo, 'distributor_rate')
      monthlyRate = r.rate; hasPlan = r.hasPlan
    } else if (role === 'master_distributor') {
      const md = mdMap[assignedTo]
      partnerName = md?.name || assignedTo
      companyName = md?.business_name || md?.name || 'Unknown'
      partnerType = 'Master Distributor'
      const r = getRate(assignedTo, 'md_rate')
      monthlyRate = r.rate; hasPlan = r.hasPlan
    } else if (role === 'partner') {
      const p = partnerMap_raw[assignedTo]
      partnerName = p?.name || assignedTo
      companyName = p?.business_name || p?.name || 'Unknown'
      partnerType = 'Partner'
      const r = getRate(assignedTo, 'distributor_rate')
      monthlyRate = r.rate; hasPlan = r.hasPlan
    } else {
      return null
    }

    return { companyName, partnerName, partnerType, monthlyRate, hasPlan }
  }

  // Build rental rows — track unique machines per partner via Set
  const partnerRowMap: Record<string, PartnerRentalRow> = {}
  const partnerMachineSet: Record<string, Set<string>> = {}
  const partnerRates: Record<string, Set<number>> = {}

  for (const assignment of assignments) {
    const pos = posMap[assignment.pos_machine_id]
    if (!pos) continue

    const info = resolvePartnerFromAssignment(assignment)
    if (!info) continue

    const partnerKey = assignment.assigned_to || 'unknown'

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

    if (!partnerRowMap[partnerKey]) {
      partnerRowMap[partnerKey] = {
        company_name: info.companyName,
        partner_name: info.partnerName,
        partner_type: info.partnerType,
        pos_count: 0,
        pos_tids: [],
        monthly_rate: 0,
        monthly_rate_display: '',
        has_plan: info.hasPlan,
        total_prorata_amount: 0,
        status: 'returned',
        machines: []
      }
      partnerMachineSet[partnerKey] = new Set()
      partnerRates[partnerKey] = new Set()
    }

    const row = partnerRowMap[partnerKey]
    if (!row.has_plan && info.hasPlan) row.has_plan = true

    // Deduplicate TIDs: only count unique machines
    const machineUid = assignment.pos_machine_id
    if (!partnerMachineSet[partnerKey].has(machineUid)) {
      partnerMachineSet[partnerKey].add(machineUid)
      row.pos_count += 1
      if (pos.tid) row.pos_tids.push(String(pos.tid))
    }

    partnerRates[partnerKey].add(info.monthlyRate)
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
      monthly_rate: info.monthlyRate,
      machine_status: assignment.status
    })
  }

  // Finalize monthly_rate_display per partner
  for (const key of Object.keys(partnerRowMap)) {
    const row = partnerRowMap[key]
    const rates = partnerRates[key]
    if (rates.size === 1) {
      const rate = [...rates][0]
      row.monthly_rate = rate
      row.monthly_rate_display = `₹${rate.toLocaleString('en-IN')}`
    } else {
      const rateArr = [...rates].sort((a, b) => a - b)
      row.monthly_rate = rateArr[0]
      row.monthly_rate_display = `₹${rateArr[0].toLocaleString('en-IN')} – ₹${rateArr[rateArr.length - 1].toLocaleString('en-IN')}`
    }
  }

  return Object.values(partnerRowMap).sort((a, b) => {
    const c = a.company_name.localeCompare(b.company_name)
    return c !== 0 ? c : a.partner_name.localeCompare(b.partner_name)
  })
}
