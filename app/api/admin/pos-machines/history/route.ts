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
    const rawLimit = parseInt(sp.get('limit') || '25', 10)
    const limit = [10, 25, 100].includes(rawLimit) ? rawLimit : 25
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

    // Fetch machine details for each unique pos_machine_id
    const machineUuids = Array.from(new Set((history || []).map((h: any) => h.pos_machine_id)))
    const machineMap: Record<string, any> = {}
    if (machineUuids.length > 0) {
      const { data: machines } = await supabase
        .from('pos_machines')
        .select('id, machine_id, serial_number, brand, tid, mid, status, inventory_status')
        .in('id', machineUuids)
      machines?.forEach((m: any) => { machineMap[m.id] = m })
    }

    const totalPages = count ? Math.ceil(count / limit) : 1

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

    const { pos_machine_id, machine_id, action, assigned_to, assigned_to_role, previous_holder, previous_holder_role, notes, return_reason } = body

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
    .select('id, machine_id, retailer_id, distributor_id, master_distributor_id, partner_id, inventory_status, created_at')
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

    return {
      pos_machine_id: m.id,
      machine_id: m.machine_id,
      action,
      assigned_by: adminEmail,
      assigned_by_role: 'admin',
      assigned_to: assignedTo,
      assigned_to_role: assignedToRole,
      status: action.startsWith('assigned_to_') ? 'active' : 'returned',
      notes: 'Backfilled from existing assignment data',
      created_at: m.created_at,
    }
  })

  const { error } = await supabase.from('pos_assignment_history').insert(records)
  if (error) {
    console.error('[POS History Backfill] Error:', error)
    return 0
  }

  return records.length
}
