import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/pos-machines/history
 * Returns full assignment history for POS machines.
 * Query params:
 *   - machine_id: filter by specific POS machine UUID
 *   - machine_code: filter by machine_id text (e.g. POS73021814)
 *   - action: filter by action type
 *   - assignment_status: filter by assignment status (active / returned)
 *   - search: free-text search
 *   - page / limit: pagination
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
    const page = parseInt(sp.get('page') || '1')
    const format = sp.get('format') || 'json'
    const rawLimit = parseInt(sp.get('limit') || '25', 10)
    const limit = format === 'csv'
      ? (rawLimit > 0 ? rawLimit : 100000)
      : ([10, 25, 100].includes(rawLimit) ? rawLimit : 25)
    const offset = (page - 1) * limit
    const machineUuid = sp.get('machine_id')
    const machineCode = sp.get('machine_code')
    const actionFilter = sp.get('action')
    const assignmentStatus = sp.get('assignment_status')
    const search = sp.get('search')

    let query = supabase
      .from('pos_assignment_history')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (machineUuid) query = query.eq('pos_machine_id', machineUuid)
    if (machineCode) query = query.ilike('machine_id', `%${machineCode}%`)
    if (actionFilter && actionFilter !== 'all') query = query.eq('action', actionFilter)
    if (assignmentStatus && assignmentStatus !== 'all') query = query.eq('status', assignmentStatus)
    if (search) {
      query = query.or(
        `machine_id.ilike.%${search}%,assigned_to.ilike.%${search}%,assigned_by.ilike.%${search}%,previous_holder.ilike.%${search}%,notes.ilike.%${search}%`
      )
    }

    query = query.range(offset, offset + limit - 1)

    const { data: history, error, count } = await query

    if (error) {
      console.error('[POS History] Error:', error)
      return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 })
    }

    // Resolve names for partner IDs
    const partnerIds = new Set<string>()
    for (const h of (history || [])) {
      if (h.assigned_to) partnerIds.add(h.assigned_to)
      if (h.assigned_by) partnerIds.add(h.assigned_by)
      if (h.previous_holder) partnerIds.add(h.previous_holder)
    }
    // Also collect current holder IDs from machines (for "Current Holder" column)
    const machineUuidsForNames = Array.from(new Set((history || []).map((h: any) => h.pos_machine_id)))
    if (machineUuidsForNames.length > 0 && format === 'csv') {
      const { data: machinesToResolve } = await supabase
        .from('pos_machines')
        .select('partner_id, master_distributor_id, distributor_id, retailer_id')
        .in('id', machineUuidsForNames)
      machinesToResolve?.forEach((m: any) => {
        if (m.partner_id) partnerIds.add(m.partner_id)
        if (m.master_distributor_id) partnerIds.add(m.master_distributor_id)
        if (m.distributor_id) partnerIds.add(m.distributor_id)
        if (m.retailer_id) partnerIds.add(m.retailer_id)
      })
    }

    const nameMap: Record<string, string> = {}
    if (partnerIds.size > 0) {
      const ids = Array.from(partnerIds)
      const [ret, dist, md, partnersById, partnersByPid, admins] = await Promise.all([
        supabase.from('retailers').select('partner_id, name').in('partner_id', ids),
        supabase.from('distributors').select('partner_id, name').in('partner_id', ids),
        supabase.from('master_distributors').select('partner_id, name').in('partner_id', ids),
        supabase.from('partners').select('id, name, business_name').in('id', ids),
        supabase.from('partners').select('id, partner_id, name, business_name').in('partner_id', ids),
        supabase.from('admin_users').select('email, name').in('email', ids),
      ])
      ret.data?.forEach((r: any) => { if (r.name) nameMap[r.partner_id] = r.name })
      dist.data?.forEach((d: any) => { if (d.name) nameMap[d.partner_id] = d.name })
      md.data?.forEach((m: any) => { if (m.name) nameMap[m.partner_id] = m.name })
      partnersById.data?.forEach((p: any) => { const n = p.name || p.business_name; if (n) nameMap[p.id] = n })
      partnersByPid.data?.forEach((p: any) => { const n = p.name || p.business_name; if (n && p.partner_id) nameMap[p.partner_id] = n })
      admins.data?.forEach((a: any) => { nameMap[a.email] = a.name || a.email })

      // Fallback: extract name from notes for any unresolved IDs
      for (const h of (history || [])) {
        const tryExtractFromNotes = (id: string) => {
          if (!h.notes) return
          const patterns = [
            /assigned to (?:Partner|Retailer|Distributor|Master Distributor)\s+(.+)/i,
            /Was assigned[_ ]to[_ ](?:partner|retailer|distributor|master[_ ]distributor)\.?\s*/i,
          ]
          for (const p of patterns) {
            const m = h.notes.match(p)
            if (m && m[1]) { nameMap[id] = m[1].trim(); return }
          }
        }
        if (h.assigned_to && !nameMap[h.assigned_to]) tryExtractFromNotes(h.assigned_to)
        if (h.previous_holder && !nameMap[h.previous_holder]) tryExtractFromNotes(h.previous_holder)
      }
    }

    // Fetch machine details for each unique pos_machine_id
    const machineUuids = Array.from(new Set((history || []).map((h: any) => h.pos_machine_id)))
    const machineMap: Record<string, any> = {}
    if (machineUuids.length > 0) {
      const { data: machines } = await supabase
        .from('pos_machines')
        .select('id, machine_id, serial_number, brand, tid, mid, status, inventory_status, partner_id, master_distributor_id, distributor_id, retailer_id')
        .in('id', machineUuids)
      machines?.forEach((m: any) => { machineMap[m.id] = m })
    }

    const totalPages = count ? Math.ceil(count / limit) : 1

    if (format === 'csv') {
      const resolveCurrentHolder = (machine: any): string => {
        if (!machine) return ''
        if (machine.partner_id && nameMap[machine.partner_id]) return nameMap[machine.partner_id]
        if (machine.master_distributor_id && nameMap[machine.master_distributor_id]) return nameMap[machine.master_distributor_id]
        if (machine.distributor_id && nameMap[machine.distributor_id]) return nameMap[machine.distributor_id]
        if (machine.retailer_id && nameMap[machine.retailer_id]) return nameMap[machine.retailer_id]
        if (machine.partner_id) return machine.partner_id
        if (machine.master_distributor_id) return machine.master_distributor_id
        if (machine.distributor_id) return machine.distributor_id
        if (machine.retailer_id) return machine.retailer_id
        if (['in_stock', 'received_from_bank'].includes(machine.inventory_status)) return 'Admin Stock'
        return ''
      }

      const resolveId = (id: string | null): string => {
        if (!id) return ''
        if (nameMap[id]) return nameMap[id]
        if (id.includes('@')) return id
        return `Unknown/Deleted (${id.substring(0, 8)}...)`
      }

      const csvRows = (history || []).map((h: any) => {
        const machine = machineMap[h.pos_machine_id]

        const wasAssignedTo = h.assigned_to
          ? resolveId(h.assigned_to)
          : (h.status === 'returned' ? 'Admin Stock' : '')
        const wasAssignedToRole = h.assigned_to_role
          ? h.assigned_to_role.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
          : (h.status === 'returned' ? 'Admin' : '')

        return {
          'Record Date': new Date(h.created_at).toLocaleDateString('en-IN'),
          'Assigned Date': h.assigned_date ? new Date(h.assigned_date).toLocaleDateString('en-IN') : '',
          'Transit Date': h.transit_date ? new Date(h.transit_date).toLocaleDateString('en-IN') : '',
          'Delivered Date': h.delivered_date ? new Date(h.delivered_date).toLocaleDateString('en-IN') : '',
          'Machine ID': h.machine_id,
          'Serial Number': machine?.serial_number || '',
          'MID': machine?.mid || '',
          'TID': machine?.tid || '',
          'Brand': machine?.brand || '',
          'Action': h.action?.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) || '',
          'Assigned By': nameMap[h.assigned_by] || h.assigned_by,
          'Assigned By Role': h.assigned_by_role?.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) || '',
          'Was Assigned To': wasAssignedTo,
          'Was Assigned To Role': wasAssignedToRole,
          'Previous Holder': h.previous_holder ? resolveId(h.previous_holder) : '',
          'Previous Holder Role': h.previous_holder_role?.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) || '',
          'Status': h.status,
          'Return Date': h.returned_date ? new Date(h.returned_date).toLocaleDateString('en-IN') : '',
          'Notes': h.notes || '',
          'Current Inventory Status': machine?.inventory_status?.replace(/_/g, ' ') || '',
          'Current Holder': resolveCurrentHolder(machine),
        }
      })

      const headers = Object.keys(csvRows[0] || {})
      const csvLines = [
        headers.join(','),
        ...csvRows.map((row: any) =>
          headers.map(h => {
            const val = String(row[h] ?? '')
            return val.includes(',') || val.includes('"') || val.includes('\n')
              ? `"${val.replace(/"/g, '""')}"`
              : val
          }).join(',')
        )
      ]

      return new NextResponse(csvLines.join('\n'), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="pos_history_${Date.now()}.csv"`,
        },
      })
    }

    return NextResponse.json({
      success: true,
      data: history || [],
      nameMap,
      machineMap,
      pagination: { page, limit, total: count || 0, totalPages },
    })
  } catch (err: any) {
    console.error('[POS History] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/admin/pos-machines/history
 * Create history record(s) or backfill.
 */
export async function POST(request: NextRequest) {
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

    const body = await request.json()

    if (body.backfill) {
      const created = await backfillHistory(supabase, user.email)
      return NextResponse.json({ success: true, message: `Backfilled ${created} history records`, count: created })
    }

    const { pos_machine_id, machine_id, action, assigned_to, assigned_to_role, previous_holder, previous_holder_role, notes, return_reason, assigned_date } = body

    if (!pos_machine_id || !machine_id || !action) {
      return NextResponse.json({ error: 'pos_machine_id, machine_id, and action are required' }, { status: 400 })
    }

    const isAssignAction = action.startsWith('assigned_to_')

    // Only one active assignment per machine is allowed (unique index). Close any existing active assignment before inserting.
    if (isAssignAction) {
      const { error: closeErr } = await supabase
        .from('pos_assignment_history')
        .update({ status: 'returned', returned_date: new Date().toISOString() })
        .eq('pos_machine_id', pos_machine_id)
        .like('action', 'assigned_to_%')
        .eq('status', 'active')
      if (closeErr) {
        console.warn('[POS History] Close previous assignment:', closeErr.message)
        // Continue anyway; insert may still succeed if DB has no unique index yet
      }
    }

    const now = new Date().toISOString()
    const { error } = await supabase.from('pos_assignment_history').insert({
      pos_machine_id,
      machine_id,
      action,
      assigned_by: user.email,
      assigned_by_role: 'admin',
      assigned_to: assigned_to || null,
      assigned_to_role: assigned_to_role || null,
      previous_holder: previous_holder || null,
      previous_holder_role: previous_holder_role || null,
      status: isAssignAction ? 'active' : 'returned',
      assigned_date: assigned_date || now,
      returned_date: isAssignAction ? null : now,
      return_reason: return_reason || null,
      notes: notes || null,
    })

    if (error) {
      console.error('[POS History] Insert error:', error)
      return NextResponse.json(
        { error: error.message || 'Failed to create history record', code: error.code },
        { status: 500 }
      )
    }

    // Log to activity_logs so it appears in Performance tab
    try {
      const ctx = getRequestContext(request)
      const desc = assigned_to_role
        ? `POS ${machine_id} ${action} → ${assigned_to_role}`
        : `POS ${machine_id} ${action}`
      logActivityFromContext(ctx, user, {
        activity_type: 'pos_machine_assign',
        activity_category: 'pos',
        activity_description: desc,
        reference_table: 'pos_machines',
        reference_id: pos_machine_id,
      }).catch(() => {})
    } catch (_) {}

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[POS History POST] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

async function backfillHistory(supabase: any, adminEmail: string): Promise<number> {
  const { data: machines } = await supabase
    .from('pos_machines')
    .select('id, machine_id, retailer_id, distributor_id, master_distributor_id, partner_id, inventory_status, created_at, last_assigned_at')
    .neq('inventory_status', 'in_stock')
    .neq('inventory_status', 'received_from_bank')
    .neq('inventory_status', 'damaged_from_bank')

  if (!machines || machines.length === 0) return 0

  const machineIds = machines.map((m: any) => m.id)
  const { data: existingHistory } = await supabase
    .from('pos_assignment_history')
    .select('pos_machine_id')
    .in('pos_machine_id', machineIds)

  const machinesWithHistory = new Set((existingHistory || []).map((h: any) => h.pos_machine_id))
  const machinesNeedingHistory = machines.filter((m: any) => !machinesWithHistory.has(m.id))

  if (machinesNeedingHistory.length === 0) return 0

  const now = new Date().toISOString()
  const records = machinesNeedingHistory.map((m: any) => {
    let action = 'created'
    let assignedTo: string | null = null
    let assignedToRole: string | null = null

    if (m.inventory_status === 'assigned_to_retailer' && m.retailer_id) {
      action = 'assigned_to_retailer'
      assignedTo = m.retailer_id
      assignedToRole = 'retailer'
    } else if (m.inventory_status === 'assigned_to_distributor' && m.distributor_id) {
      action = 'assigned_to_distributor'
      assignedTo = m.distributor_id
      assignedToRole = 'distributor'
    } else if (m.inventory_status === 'assigned_to_master_distributor' && m.master_distributor_id) {
      action = 'assigned_to_master_distributor'
      assignedTo = m.master_distributor_id
      assignedToRole = 'master_distributor'
    } else if (m.inventory_status === 'assigned_to_partner' && m.partner_id) {
      action = 'assigned_to_partner'
      assignedTo = m.partner_id
      assignedToRole = 'partner'
    }

    const isActive = action.startsWith('assigned_to_')
    const eventDate = m.last_assigned_at || m.created_at

    return {
      pos_machine_id: m.id,
      machine_id: m.machine_id,
      action,
      assigned_by: adminEmail,
      assigned_by_role: 'admin',
      assigned_to: assignedTo,
      assigned_to_role: assignedToRole,
      status: isActive ? 'active' : 'returned',
      returned_date: isActive ? null : now,
      notes: 'Backfilled from existing assignment data',
      created_at: eventDate,
    }
  })

  const { error } = await supabase.from('pos_assignment_history').insert(records)
  if (error) {
    console.error('[POS History Backfill] Error:', error)
    return 0
  }

  return records.length
}
