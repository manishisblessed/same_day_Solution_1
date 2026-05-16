import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { upsertSubscriptionOnAssign } from '@/lib/subscription/upsert-subscription-on-assign'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BULK = 100

/**
 * POST /api/pos-machines/bulk-assign
 * Role-aware bulk assignment:
 *   - master_distributor → distributor (machines must be assigned_to_master_distributor with matching MD)
 *   - distributor → retailer (machines must be assigned_to_distributor with matching DT)
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    }

    if (!['master_distributor', 'distributor'].includes(user.role)) {
      return NextResponse.json({ error: 'Only Master Distributors and Distributors can bulk-assign' }, { status: 403 })
    }
    if (!user.partner_id) {
      return NextResponse.json({ error: 'User partner_id is missing' }, { status: 400 })
    }
    const partnerId: string = user.partner_id

    const body = await request.json()
    const { machine_ids: rawIds, assign_to, notes, subscription_amount, billing_day, gst_percent, assigned_date } = body

    if (!assign_to || typeof assign_to !== 'string') {
      return NextResponse.json({ error: 'assign_to is required' }, { status: 400 })
    }
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return NextResponse.json({ error: 'machine_ids array is required' }, { status: 400 })
    }

    const machineIds = Array.from(new Set(rawIds.map((id: unknown) => String(id)).filter(Boolean)))
    if (machineIds.length > MAX_BULK) {
      return NextResponse.json({ error: `At most ${MAX_BULK} machines per request` }, { status: 400 })
    }

    const subAmount = subscription_amount != null ? Number(subscription_amount) : null
    const bDay = billing_day != null ? Math.max(1, Math.min(28, parseInt(String(billing_day), 10) || 1)) : 1
    const gst = gst_percent != null ? Number(gst_percent) : 18

    // Validate target
    if (user.role === 'master_distributor') {
      const { data: dist, error: distErr } = await supabase
        .from('distributors')
        .select('partner_id, name, status, master_distributor_id')
        .eq('partner_id', assign_to)
        .single()
      if (distErr || !dist) return NextResponse.json({ error: 'Invalid Distributor' }, { status: 400 })
      if (dist.master_distributor_id !== partnerId) return NextResponse.json({ error: 'Distributor is not under your network' }, { status: 403 })
      if (dist.status !== 'active') return NextResponse.json({ error: 'Distributor is not active' }, { status: 400 })
    } else {
      const { data: rt, error: rtErr } = await supabase
        .from('retailers')
        .select('partner_id, name, status, distributor_id')
        .eq('partner_id', assign_to)
        .single()
      if (rtErr || !rt) return NextResponse.json({ error: 'Invalid Retailer' }, { status: 400 })
      if (rt.distributor_id !== partnerId) return NextResponse.json({ error: 'Retailer is not under your network' }, { status: 403 })
      if (rt.status !== 'active') return NextResponse.json({ error: 'Retailer is not active' }, { status: 400 })
    }

    const { data: machines, error: fetchErr } = await supabase
      .from('pos_machines')
      .select('*')
      .in('id', machineIds)

    if (fetchErr) return NextResponse.json({ error: 'Failed to fetch machines' }, { status: 500 })

    const byId = new Map((machines || []).map((m: any) => [m.id, m]))
    const succeeded: { id: string; machine_id: string; message: string }[] = []
    const failed: { id: string; error: string }[] = []

    for (const id of machineIds) {
      const machine = byId.get(id)
      if (!machine) { failed.push({ id, error: 'POS machine not found' }); continue }

      try {
        if (user.role === 'master_distributor') {
          if (machine.master_distributor_id !== partnerId) {
            failed.push({ id, error: 'Machine not assigned to you' }); continue
          }
          if (machine.inventory_status !== 'assigned_to_master_distributor') {
            failed.push({ id, error: `Status "${machine.inventory_status}" — only "assigned_to_master_distributor" can be assigned` }); continue
          }

          const { data: activeAsgn } = await supabase
            .from('pos_assignment_history')
            .select('id, assigned_to, assigned_to_role')
            .eq('pos_machine_id', id).eq('status', 'active').like('action', 'assigned_to_%')
            .limit(1).maybeSingle()

          if (activeAsgn) {
            await supabase.from('pos_assignment_history')
              .update({ status: 'returned', returned_date: new Date().toISOString() })
              .eq('id', activeAsgn.id)
          }

          const effectiveDate = assigned_date || new Date().toISOString()

          const { error: upErr } = await supabase.from('pos_machines').update({
            partner_id: null,
            distributor_id: assign_to,
            retailer_id: null,
            inventory_status: 'assigned_to_distributor',
            assigned_by: partnerId,
            assigned_by_role: 'master_distributor',
            last_assigned_at: effectiveDate,
            updated_at: new Date().toISOString(),
          }).eq('id', id)

          if (upErr) { failed.push({ id, error: 'DB update failed' }); continue }

          await supabase.from('pos_assignment_history').insert({
            pos_machine_id: id,
            machine_id: machine.machine_id,
            action: 'assigned_to_distributor',
            assigned_by: partnerId,
            assigned_by_role: 'master_distributor',
            assigned_to: assign_to,
            assigned_to_role: 'distributor',
            previous_holder: machine.distributor_id || null,
            previous_holder_role: machine.distributor_id ? 'distributor' : null,
            status: 'active',
            assigned_date: effectiveDate,
            notes: notes || 'Bulk assigned by MD',
          })

          if (subAmount != null && subAmount > 0) {
            await upsertSubscriptionOnAssign({
              supabase, assignee_user_id: assign_to, assignee_user_role: 'distributor',
              machine: { machine_id: machine.machine_id, retailer_id: null, distributor_id: assign_to, master_distributor_id: machine.master_distributor_id },
              rate_per_unit: subAmount, billing_day: bDay, gst_percent: gst,
              assigned_by: partnerId, assigned_by_role: 'master_distributor',
            }).catch(() => {})
          }

          succeeded.push({ id, machine_id: machine.machine_id, message: 'Assigned to Distributor' })

        } else {
          // distributor → retailer
          if (machine.distributor_id !== partnerId) {
            failed.push({ id, error: 'Machine not assigned to you' }); continue
          }
          if (machine.inventory_status !== 'assigned_to_distributor') {
            failed.push({ id, error: `Status "${machine.inventory_status}" — only "assigned_to_distributor" can be assigned` }); continue
          }

          const { data: activeAsgn } = await supabase
            .from('pos_assignment_history')
            .select('id, assigned_to, assigned_to_role')
            .eq('pos_machine_id', id).eq('status', 'active').like('action', 'assigned_to_%')
            .limit(1).maybeSingle()

          if (activeAsgn && activeAsgn.assigned_to !== assign_to) {
            await supabase.from('pos_assignment_history')
              .update({ status: 'returned', returned_date: new Date().toISOString() })
              .eq('id', activeAsgn.id)
          }

          const effectiveDateRt = assigned_date || new Date().toISOString()

          const { error: upErr } = await supabase.from('pos_machines').update({
            partner_id: null,
            retailer_id: assign_to,
            inventory_status: 'assigned_to_retailer',
            assigned_by: partnerId,
            assigned_by_role: 'distributor',
            last_assigned_at: effectiveDateRt,
            updated_at: new Date().toISOString(),
          }).eq('id', id)

          if (upErr) { failed.push({ id, error: 'DB update failed' }); continue }

          await supabase.from('pos_assignment_history').insert({
            pos_machine_id: id,
            machine_id: machine.machine_id,
            action: 'assigned_to_retailer',
            assigned_by: partnerId,
            assigned_by_role: 'distributor',
            assigned_to: assign_to,
            assigned_to_role: 'retailer',
            previous_holder: machine.retailer_id || null,
            previous_holder_role: machine.retailer_id ? 'retailer' : null,
            status: 'active',
            assigned_date: effectiveDateRt,
            notes: notes || 'Bulk assigned by Distributor',
          })

          if (subAmount != null && subAmount > 0) {
            await upsertSubscriptionOnAssign({
              supabase, assignee_user_id: assign_to, assignee_user_role: 'retailer',
              machine: { machine_id: machine.machine_id, retailer_id: assign_to, distributor_id: machine.distributor_id, master_distributor_id: machine.master_distributor_id },
              rate_per_unit: subAmount, billing_day: bDay, gst_percent: gst,
              assigned_by: partnerId, assigned_by_role: 'distributor',
            }).catch(() => {})
          }

          succeeded.push({ id, machine_id: machine.machine_id, message: 'Assigned to Retailer' })
        }

        const ctx = getRequestContext(request)
        logActivityFromContext(ctx, user, {
          activity_type: 'pos_machine_assign',
          activity_category: 'pos',
          activity_description: `Bulk assigned POS ${machine.machine_id} to ${user.role === 'master_distributor' ? 'distributor' : 'retailer'} ${assign_to}`,
          reference_table: 'pos_machines',
          reference_id: id,
        }).catch(() => {})
      } catch (e: any) {
        failed.push({ id, error: e?.message || 'Unexpected error' })
      }
    }

    return NextResponse.json({
      success: failed.length === 0,
      total: machineIds.length,
      succeeded_count: succeeded.length,
      failed_count: failed.length,
      succeeded,
      failed,
    })
  } catch (error: any) {
    console.error('Error in POST /api/pos-machines/bulk-assign:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
