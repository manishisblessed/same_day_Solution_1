import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BULK = 100

/**
 * POST /api/pos-machines/bulk-recall
 * Recall (return) machines back to the caller's inventory:
 *   - master_distributor: recall from distributor/retailer → back to MD
 *   - distributor: recall from retailer → back to DT
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
      return NextResponse.json({ error: 'Only Master Distributors and Distributors can recall machines' }, { status: 403 })
    }

    const body = await request.json()
    const { machine_ids: rawIds, notes } = body

    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return NextResponse.json({ error: 'machine_ids array is required' }, { status: 400 })
    }

    const machineIds = Array.from(new Set(rawIds.map((id: unknown) => String(id)).filter(Boolean)))
    if (machineIds.length > MAX_BULK) {
      return NextResponse.json({ error: `At most ${MAX_BULK} machines per request` }, { status: 400 })
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
          if (machine.master_distributor_id !== user.partner_id) {
            failed.push({ id, error: 'Machine not in your network' }); continue
          }
          const recallable = ['assigned_to_distributor', 'assigned_to_retailer']
          if (!recallable.includes(machine.inventory_status || '')) {
            failed.push({ id, error: `Status "${machine.inventory_status}" — can only recall from distributor/retailer` }); continue
          }

          // Close active assignment
          const { data: activeAsgn } = await supabase
            .from('pos_assignment_history')
            .select('id')
            .eq('pos_machine_id', id).eq('status', 'active').like('action', 'assigned_to_%')
            .limit(1).maybeSingle()

          if (activeAsgn) {
            await supabase.from('pos_assignment_history')
              .update({ status: 'returned', returned_date: new Date().toISOString() })
              .eq('id', activeAsgn.id)
          }

          const { error: upErr } = await supabase.from('pos_machines').update({
            partner_id: null,  // Clear partner_id when recalling to hierarchy
            distributor_id: null,
            retailer_id: null,
            inventory_status: 'assigned_to_master_distributor',
            assigned_by: user.partner_id,
            assigned_by_role: 'master_distributor',
            last_assigned_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('id', id)

          if (upErr) { failed.push({ id, error: 'DB update failed' }); continue }

          await supabase.from('pos_assignment_history').insert({
            pos_machine_id: id,
            machine_id: machine.machine_id,
            action: 'recalled_to_master_distributor',
            assigned_by: user.partner_id,
            assigned_by_role: 'master_distributor',
            assigned_to: user.partner_id,
            assigned_to_role: 'master_distributor',
            previous_holder: machine.retailer_id || machine.distributor_id || null,
            previous_holder_role: machine.retailer_id ? 'retailer' : machine.distributor_id ? 'distributor' : null,
            status: 'active',
            notes: notes || 'Recalled by MD',
          })

          succeeded.push({ id, machine_id: machine.machine_id, message: 'Recalled to MD inventory' })

        } else {
          // distributor recalls from retailer
          if (machine.distributor_id !== user.partner_id) {
            failed.push({ id, error: 'Machine not in your network' }); continue
          }
          if (machine.inventory_status !== 'assigned_to_retailer') {
            failed.push({ id, error: `Status "${machine.inventory_status}" — can only recall from retailer` }); continue
          }

          const { data: activeAsgn } = await supabase
            .from('pos_assignment_history')
            .select('id')
            .eq('pos_machine_id', id).eq('status', 'active').like('action', 'assigned_to_%')
            .limit(1).maybeSingle()

          if (activeAsgn) {
            await supabase.from('pos_assignment_history')
              .update({ status: 'returned', returned_date: new Date().toISOString() })
              .eq('id', activeAsgn.id)
          }

          const { error: upErr } = await supabase.from('pos_machines').update({
            partner_id: null,  // Clear partner_id when recalling to hierarchy
            retailer_id: null,
            inventory_status: 'assigned_to_distributor',
            assigned_by: user.partner_id,
            assigned_by_role: 'distributor',
            last_assigned_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('id', id)

          if (upErr) { failed.push({ id, error: 'DB update failed' }); continue }

          await supabase.from('pos_assignment_history').insert({
            pos_machine_id: id,
            machine_id: machine.machine_id,
            action: 'recalled_to_distributor',
            assigned_by: user.partner_id,
            assigned_by_role: 'distributor',
            assigned_to: user.partner_id,
            assigned_to_role: 'distributor',
            previous_holder: machine.retailer_id || null,
            previous_holder_role: machine.retailer_id ? 'retailer' : null,
            status: 'active',
            notes: notes || 'Recalled by Distributor',
          })

          succeeded.push({ id, machine_id: machine.machine_id, message: 'Recalled to DT inventory' })
        }

        const ctx = getRequestContext(request)
        logActivityFromContext(ctx, user, {
          activity_type: 'pos_machine_recall',
          activity_category: 'pos',
          activity_description: `Recalled POS ${machine.machine_id} back to ${user.role} inventory`,
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
    console.error('Error in POST /api/pos-machines/bulk-recall:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
