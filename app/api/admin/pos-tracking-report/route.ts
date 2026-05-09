import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/pos-tracking-report
 *
 * POS Tracking History Report – provides three views:
 *   view=device     → full lifecycle of a single POS device
 *   view=merchant   → all POS activity for a specific merchant (partner_id)
 *   view=movement   → date-range movement log across all devices
 *
 * Common query params:
 *   search, date_from, date_to, page, limit, format (json|csv)
 *
 * Device view extras:  machine_id (UUID) or machine_code (text)
 * Merchant view extras: merchant_id (partner_id)
 */
export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { user } = await getCurrentUserWithFallback(request)

    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized. Admin only.' }, { status: 403 })
    }

    const sp = request.nextUrl.searchParams
    const view = sp.get('view') || 'movement'
    const format = sp.get('format') || 'json'
    const page = Math.max(1, parseInt(sp.get('page') || '1'))
    const rawLimit = parseInt(sp.get('limit') || '25')
    
    let limit: number
    if (format === 'csv') {
      limit = rawLimit > 0 ? rawLimit : 100000
    } else {
      limit = [10, 25, 50, 100].includes(rawLimit) ? rawLimit : 25
    }
    
    const offset = (page - 1) * limit
    const dateFrom = sp.get('date_from')
    const dateTo = sp.get('date_to')
    const search = sp.get('search')

    let query = supabase
      .from('pos_assignment_history')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (dateFrom) query = query.gte('created_at', dateFrom)
    if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59.999Z')

    if (view === 'device') {
      const machineUuid = sp.get('machine_id')
      const machineCode = sp.get('machine_code')
      if (machineUuid) query = query.eq('pos_machine_id', machineUuid)
      else if (machineCode) query = query.ilike('machine_id', `%${machineCode}%`)
    } else if (view === 'merchant') {
      const merchantId = sp.get('merchant_id')
      if (merchantId) {
        query = query.or(`assigned_to.eq.${merchantId},previous_holder.eq.${merchantId}`)
      }
    }

    if (search) {
      query = query.or(
        `machine_id.ilike.%${search}%,assigned_to.ilike.%${search}%,assigned_by.ilike.%${search}%,previous_holder.ilike.%${search}%,notes.ilike.%${search}%,return_reason.ilike.%${search}%`
      )
    }

    query = query.range(offset, offset + limit - 1)

    const { data: history, error, count } = await query

    if (error) {
      console.error('[POS Tracking Report] Query error:', error)
      return NextResponse.json({ error: 'Failed to fetch tracking data' }, { status: 500 })
    }

    const partnerIds = new Set<string>()
    for (const h of (history || [])) {
      if (h.assigned_to) partnerIds.add(h.assigned_to)
      if (h.assigned_by) partnerIds.add(h.assigned_by)
      if (h.previous_holder) partnerIds.add(h.previous_holder)
    }

    const nameMap: Record<string, string> = {}
    if (partnerIds.size > 0) {
      const ids = Array.from(partnerIds)
      const [ret, dist, md, partners, admins] = await Promise.all([
        supabase.from('retailers').select('partner_id, name').in('partner_id', ids),
        supabase.from('distributors').select('partner_id, name').in('partner_id', ids),
        supabase.from('master_distributors').select('partner_id, name').in('partner_id', ids),
        supabase.from('partners').select('id, name').in('id', ids),
        supabase.from('admin_users').select('email, name').in('email', ids),
      ])
      ret.data?.forEach((r: any) => { nameMap[r.partner_id] = r.name })
      dist.data?.forEach((d: any) => { nameMap[d.partner_id] = d.name })
      md.data?.forEach((m: any) => { nameMap[m.partner_id] = m.name })
      partners.data?.forEach((p: any) => { nameMap[p.id] = p.name })
      admins.data?.forEach((a: any) => { nameMap[a.email] = a.name })
    }

    const machineUuids = Array.from(new Set((history || []).map((h: any) => h.pos_machine_id)))
    const machineMap: Record<string, any> = {}
    if (machineUuids.length > 0) {
      const { data: machines } = await supabase
        .from('pos_machines')
        .select('id, machine_id, serial_number, brand, tid, mid, status, inventory_status')
        .in('id', machineUuids)
      machines?.forEach((m: any) => { machineMap[m.id] = m })
    }

    // Summary stats — query full dataset, not just the current page
    const buildSummaryQuery = (extraFilter?: (q: any) => any) => {
      let q = supabase
        .from('pos_assignment_history')
        .select('id', { count: 'exact', head: true })
      if (dateFrom) q = q.gte('created_at', dateFrom)
      if (dateTo) q = q.lte('created_at', dateTo + 'T23:59:59.999Z')
      if (search) {
        q = q.or(
          `machine_id.ilike.%${search}%,assigned_to.ilike.%${search}%,assigned_by.ilike.%${search}%,previous_holder.ilike.%${search}%,notes.ilike.%${search}%,return_reason.ilike.%${search}%`
        )
      }
      if (view === 'device') {
        const machineUuid = sp.get('machine_id')
        const machineCode = sp.get('machine_code')
        if (machineUuid) q = q.eq('pos_machine_id', machineUuid)
        else if (machineCode) q = q.ilike('machine_id', `%${machineCode}%`)
      } else if (view === 'merchant') {
        const merchantId = sp.get('merchant_id')
        if (merchantId) q = q.or(`assigned_to.eq.${merchantId},previous_holder.eq.${merchantId}`)
      }
      if (extraFilter) q = extraFilter(q)
      return q
    }

    const [assignRes, returnRes, reassignRes, activeRes] = await Promise.all([
      buildSummaryQuery(q => q.like('action', 'assigned_to_%')),
      buildSummaryQuery(q => q.like('action', 'unassigned_from_%')),
      buildSummaryQuery(q => q.eq('action', 'reassigned')),
      buildSummaryQuery(q => q.eq('status', 'active')),
    ])

    const totalAssignments = assignRes.count || 0
    const totalReturns = returnRes.count || 0
    const totalReassignments = reassignRes.count || 0
    const activeAssignments = activeRes.count || 0

    const totalPages = count ? Math.ceil(count / limit) : 1

    if (format === 'csv') {
      const rows = (history || []).map((h: any) => {
        const machine = machineMap[h.pos_machine_id]
        return {
          'Record Date': new Date(h.created_at).toLocaleDateString('en-IN'),
          'Assigned Date': h.assigned_date ? new Date(h.assigned_date).toLocaleDateString('en-IN') : '',
          'Machine ID': h.machine_id,
          'Serial Number': machine?.serial_number || '',
          'MID': machine?.mid || '',
          'TID': machine?.tid || '',
          'Brand': machine?.brand || '',
          'Action': formatAction(h.action),
          'Assigned By': nameMap[h.assigned_by] || h.assigned_by,
          'Assigned By Role': formatRole(h.assigned_by_role),
          'Assigned To': h.assigned_to ? (nameMap[h.assigned_to] || h.assigned_to) : '',
          'Assigned To Role': formatRole(h.assigned_to_role),
          'Previous Holder': h.previous_holder ? (nameMap[h.previous_holder] || h.previous_holder) : '',
          'Previous Holder Role': formatRole(h.previous_holder_role),
          'Status': h.status,
          'Return Date': h.returned_date ? new Date(h.returned_date).toLocaleDateString('en-IN') : '',
          'Return Reason': h.return_reason || '',
          'Notes': h.notes || '',
          'Current Inventory Status': machine?.inventory_status?.replace(/_/g, ' ') || '',
        }
      })

      const headers = Object.keys(rows[0] || {})
      const csvLines = [
        headers.join(','),
        ...rows.map(row =>
          headers.map(h => {
            const val = String((row as any)[h] ?? '')
            return val.includes(',') || val.includes('"') || val.includes('\n')
              ? `"${val.replace(/"/g, '""')}"`
              : val
          }).join(',')
        )
      ]

      return new NextResponse(csvLines.join('\n'), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="pos_tracking_report_${Date.now()}.csv"`,
        },
      })
    }

    return NextResponse.json({
      success: true,
      view,
      data: history || [],
      nameMap,
      machineMap,
      summary: {
        totalAssignments,
        totalReturns,
        totalReassignments,
        activeAssignments,
      },
      pagination: { page, limit, total: count || 0, totalPages },
    })
  } catch (err: any) {
    console.error('[POS Tracking Report] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

function formatAction(action: string): string {
  const map: Record<string, string> = {
    created: 'Created / Received',
    assigned_to_master_distributor: 'Assigned to Master Distributor',
    assigned_to_distributor: 'Assigned to Distributor',
    assigned_to_retailer: 'Assigned to Retailer',
    assigned_to_partner: 'Assigned to Partner',
    unassigned_from_retailer: 'Returned from Retailer',
    unassigned_from_distributor: 'Returned from Distributor',
    unassigned_from_master_distributor: 'Returned from Master Distributor',
    unassigned_from_partner: 'Returned from Partner',
    reassigned: 'Reassigned',
    recalled_to_master_distributor: 'Recalled to Master Distributor',
    recalled_to_distributor: 'Recalled to Distributor',
  }
  return map[action] || action
}

function formatRole(role: string | null): string {
  if (!role) return ''
  return role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
