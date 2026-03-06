import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/pos-machines/return
 * Return a POS machine to stock. Clears assignment and sets inventory_status to in_stock.
 * Admin only. Used when a retailer/partner returns a machine so it can be reassigned.
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
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized. Admin only.' }, { status: 403 })
    }

    const body = await request.json()
    const { machine_id } = body

    if (!machine_id) {
      return NextResponse.json({ error: 'machine_id is required' }, { status: 400 })
    }

    const { data: machine, error: fetchError } = await supabase
      .from('pos_machines')
      .select('*')
      .eq('id', machine_id)
      .single()

    if (fetchError || !machine) {
      return NextResponse.json({ error: 'POS machine not found' }, { status: 404 })
    }

    const currentStatus = machine.inventory_status
    const canReturn = [
      'assigned_to_retailer',
      'assigned_to_distributor',
      'assigned_to_master_distributor',
      'assigned_to_partner',
    ].includes(currentStatus)

    if (!canReturn) {
      return NextResponse.json(
        { error: `Machine cannot be returned. Current status: ${currentStatus}. Only assigned machines can be returned to stock.` },
        { status: 400 }
      )
    }

    const previousHolder = machine.retailer_id || machine.distributor_id || machine.master_distributor_id || machine.partner_id
    const previousHolderRole = machine.retailer_id
      ? 'retailer'
      : machine.distributor_id
        ? 'distributor'
        : machine.master_distributor_id
          ? 'master_distributor'
          : machine.partner_id
            ? 'partner'
            : null

    // 1. Update pos_machines: in_stock, clear all assignment fields
    const { error: updateError } = await supabase
      .from('pos_machines')
      .update({
        inventory_status: 'in_stock',
        retailer_id: null,
        distributor_id: null,
        master_distributor_id: null,
        partner_id: null,
        assigned_by: null,
        assigned_by_role: null,
        last_assigned_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', machine_id)

    if (updateError) {
      console.error('[POS Return] Update pos_machines error:', updateError)
      return NextResponse.json({ error: 'Failed to return machine to stock' }, { status: 500 })
    }

    // 2. Remove from pos_device_mapping (so Razorpay txns don't map to old retailer)
    if (machine.serial_number) {
      await supabase
        .from('pos_device_mapping')
        .delete()
        .eq('device_serial', machine.serial_number)
    }

    // 3. Remove from partner_pos_machines if it was assigned to partner
    if (machine.tid) {
      await supabase
        .from('partner_pos_machines')
        .delete()
        .eq('terminal_id', machine.tid)
    }

    // 4. Record in pos_assignment_history
    const unassignAction =
      previousHolderRole === 'retailer'
        ? 'unassigned_from_retailer'
        : previousHolderRole === 'distributor'
          ? 'unassigned_from_distributor'
          : previousHolderRole === 'master_distributor'
            ? 'unassigned_from_master_distributor'
            : previousHolderRole === 'partner'
              ? 'unassigned_from_partner'
              : 'unassigned_from_retailer'

    await supabase.from('pos_assignment_history').insert({
      pos_machine_id: machine_id,
      machine_id: machine.machine_id || machine.id,
      action: unassignAction,
      assigned_by: user.partner_id || user.id,
      assigned_by_role: 'admin',
      assigned_to: null,
      assigned_to_role: null,
      previous_holder: previousHolder,
      previous_holder_role: previousHolderRole,
      notes: `Returned to stock by admin. Was ${currentStatus}.`,
    })

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, {
      activity_type: 'pos_machine_return_to_stock',
      activity_category: 'pos',
      activity_description: `Returned POS machine ${machine.machine_id || machine.serial_number || machine_id} to stock (was ${currentStatus})`,
      reference_table: 'pos_machines',
      reference_id: machine_id,
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      message: 'Machine returned to stock successfully',
      machine_id,
      previous_status: currentStatus,
    })
  } catch (error: any) {
    console.error('[POS Return] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
