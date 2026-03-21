import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { upsertSubscriptionOnAssign } from '@/lib/subscription/upsert-subscription-on-assign'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/pos-machines/assign
 * Hierarchical POS machine assignment with atomic transaction:
 * - Admin → Master Distributor / Partner
 * - Master Distributor → Distributor
 * - Distributor → Retailer
 *
 * Uses the `assign_pos_device` RPC for atomicity. Falls back to
 * multi-step approach if the RPC is not yet deployed.
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { user, method } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }

    const body = await request.json()
    const {
      machine_id,
      assign_to,
      assign_to_type,
      notes,
      subscription_amount,
      billing_day,
      gst_percent,
    } = body

    if (!machine_id) {
      return NextResponse.json({ error: 'machine_id is required' }, { status: 400 })
    }
    if (!assign_to) {
      return NextResponse.json({ error: 'assign_to is required' }, { status: 400 })
    }

    // Fetch the POS machine
    const { data: machine, error: fetchError } = await supabase
      .from('pos_machines')
      .select('*')
      .eq('id', machine_id)
      .single()

    if (fetchError || !machine) {
      return NextResponse.json({ error: 'POS machine not found' }, { status: 404 })
    }

    // Check for existing active assignment (prevent double assignment)
    const { data: activeAssignment } = await supabase
      .from('pos_assignment_history')
      .select('id, assigned_to, assigned_to_role')
      .eq('pos_machine_id', machine_id)
      .eq('status', 'active')
      .like('action', 'assigned_to_%')
      .limit(1)
      .maybeSingle()

    const subAmount = subscription_amount != null ? Number(subscription_amount) : null
    const bDay = billing_day != null ? Math.max(1, Math.min(28, parseInt(String(billing_day), 10) || 1)) : 1
    const gst = gst_percent != null ? Number(gst_percent) : 18

    switch (user.role) {
      case 'admin': {
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assign_to)
        const shouldAssignToPartner = assign_to_type === 'partner' || (isUUID && assign_to_type !== 'master_distributor')

        if (shouldAssignToPartner) {
          return await assignToPartner(supabase, request, user, machine, assign_to, notes, activeAssignment)
        } else {
          return await assignToMasterDistributor(supabase, request, user, machine, assign_to, notes, activeAssignment, subAmount, bDay, gst)
        }
      }

      case 'master_distributor': {
        return await assignToDistributor(supabase, request, user, machine, assign_to, notes, activeAssignment, subAmount, bDay, gst)
      }

      case 'distributor': {
        return await assignToRetailer(supabase, request, user, machine, assign_to, notes, activeAssignment, subAmount, bDay, gst)
      }

      default:
        return NextResponse.json({ error: 'Retailers cannot assign POS machines' }, { status: 403 })
    }

  } catch (error: any) {
    console.error('Error in POST /api/pos-machines/assign:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ─── Helpers ────────────────────────────────────────────────

async function closeActiveAssignment(supabase: any, machineId: string, activeAssignment: any) {
  if (activeAssignment) {
    await supabase
      .from('pos_assignment_history')
      .update({ status: 'returned', returned_date: new Date().toISOString() })
      .eq('id', activeAssignment.id)
  }
}

function logAssignment(request: NextRequest, user: any, machine: any, targetId: string, targetRole: string) {
  const ctx = getRequestContext(request)
  logActivityFromContext(ctx, user, {
    activity_type: 'pos_machine_assign',
    activity_category: 'pos',
    activity_description: `Assigned POS machine ${machine.machine_id || machine.serial_number} to ${targetRole} ${targetId}`,
    reference_table: 'pos_machines',
    reference_id: machine.id,
  }).catch(() => {})
}

// ─── Admin → Partner ────────────────────────────────────────

async function assignToPartner(
  supabase: any, request: NextRequest, user: any,
  machine: any, assignTo: string, notes: string | undefined,
  activeAssignment: any
) {
  const { data: partner, error: partnerError } = await supabase
    .from('partners')
    .select('id, name, status, business_name')
    .eq('id', assignTo)
    .single()

  if (partnerError || !partner) {
    return NextResponse.json({ error: 'Invalid Partner selected' }, { status: 400 })
  }
  if (partner.status !== 'active') {
    return NextResponse.json({ error: 'Partner is not active' }, { status: 400 })
  }

  // Close any existing active assignment first
  await closeActiveAssignment(supabase, machine.id, activeAssignment)

  // Update pos_machines atomically
  const { error: updateError } = await supabase
    .from('pos_machines')
    .update({
      partner_id: assignTo,
      master_distributor_id: null,
      distributor_id: null,
      retailer_id: null,
      inventory_status: 'assigned_to_partner',
      status: machine.status === 'returned' ? 'active' : machine.status,
      assigned_by: user.email,
      assigned_by_role: 'admin',
      last_assigned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', machine.id)

  if (updateError) {
    console.error('Error assigning machine to Partner:', updateError)
    return NextResponse.json({ error: 'Failed to assign machine' }, { status: 500 })
  }

  // Update pos_device_mapping
  if (machine.serial_number) {
    const { data: existingMapping } = await supabase
      .from('pos_device_mapping')
      .select('id')
      .eq('device_serial', machine.serial_number)
      .single()

    if (existingMapping) {
      await supabase
        .from('pos_device_mapping')
        .update({
          retailer_id: null,
          distributor_id: null,
          master_distributor_id: null,
          status: 'INACTIVE',
        })
        .eq('id', existingMapping.id)
    }
  }

  // Sync to partner_pos_machines
  await syncPartnerPosMachine(supabase, machine, assignTo, partner)

  // Create NEW assignment history record (never overwrite old)
  await supabase.from('pos_assignment_history').insert({
    pos_machine_id: machine.id,
    machine_id: machine.machine_id,
    action: 'assigned_to_partner',
    assigned_by: user.email,
    assigned_by_role: 'admin',
    assigned_to: assignTo,
    assigned_to_role: 'partner',
    previous_holder: machine.partner_id || machine.retailer_id || machine.distributor_id || machine.master_distributor_id || null,
    previous_holder_role: machine.partner_id ? 'partner' : machine.retailer_id ? 'retailer' : machine.distributor_id ? 'distributor' : machine.master_distributor_id ? 'master_distributor' : null,
    status: 'active',
    notes: notes || `Admin assigned to Partner ${partner.name}`,
  })

  logAssignment(request, user, machine, assignTo, 'partner')

  return NextResponse.json({
    success: true,
    message: `POS machine ${machine.machine_id} assigned to Partner ${partner.name}`,
  })
}

// ─── Admin → Master Distributor ─────────────────────────────

async function assignToMasterDistributor(
  supabase: any, request: NextRequest, user: any,
  machine: any, assignTo: string, notes: string | undefined,
  activeAssignment: any,
  subscriptionAmount: number | null, billingDay: number, gstPercent: number
) {
  const { data: md, error: mdError } = await supabase
    .from('master_distributors')
    .select('partner_id, name, status')
    .eq('partner_id', assignTo)
    .single()

  if (mdError || !md) {
    return NextResponse.json({ error: 'Invalid Master Distributor selected' }, { status: 400 })
  }
  if (md.status !== 'active') {
    return NextResponse.json({ error: 'Master Distributor is not active' }, { status: 400 })
  }

  const isReturned = machine.status === 'returned'
  if (!isReturned && machine.inventory_status && !['in_stock', 'received_from_bank'].includes(machine.inventory_status)) {
    return NextResponse.json({
      error: `Machine is currently "${machine.inventory_status}". Only in_stock, received_from_bank, or returned machines can be assigned to a Master Distributor.`
    }, { status: 400 })
  }

  // Close any existing active assignment
  await closeActiveAssignment(supabase, machine.id, activeAssignment)

  // Remove from partner_pos_machines if previously assigned to partner
  if (machine.partner_id && machine.tid) {
    await supabase
      .from('partner_pos_machines')
      .delete()
      .eq('terminal_id', machine.tid)
  }

  const { error: updateError } = await supabase
    .from('pos_machines')
    .update({
      master_distributor_id: assignTo,
      partner_id: null,
      distributor_id: null,
      retailer_id: null,
      inventory_status: 'assigned_to_master_distributor',
      status: isReturned ? 'active' : machine.status,
      assigned_by: user.email,
      assigned_by_role: 'admin',
      last_assigned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', machine.id)

  if (updateError) {
    console.error('Error assigning machine to MD:', updateError)
    return NextResponse.json({ error: 'Failed to assign machine' }, { status: 500 })
  }

  await supabase.from('pos_assignment_history').insert({
    pos_machine_id: machine.id,
    machine_id: machine.machine_id,
    action: 'assigned_to_master_distributor',
    assigned_by: user.email,
    assigned_by_role: 'admin',
    assigned_to: assignTo,
    assigned_to_role: 'master_distributor',
    previous_holder: machine.master_distributor_id || null,
    previous_holder_role: machine.master_distributor_id ? 'master_distributor' : null,
    status: 'active',
    notes: notes || `Admin assigned to ${md.name}`,
  })

  logAssignment(request, user, machine, assignTo, 'master_distributor')

  if (subscriptionAmount != null && subscriptionAmount > 0) {
    const subResult = await upsertSubscriptionOnAssign({
      supabase,
      assignee_user_id: assignTo,
      assignee_user_role: 'master_distributor',
      machine: { machine_id: machine.machine_id, retailer_id: null, distributor_id: null, master_distributor_id: assignTo },
      rate_per_unit: subscriptionAmount,
      billing_day: billingDay,
      gst_percent: gstPercent,
      assigned_by: user.partner_id || user.id || user.email,
      assigned_by_role: 'admin',
    })
    if (!subResult.success) {
      console.error('[Assign] Subscription upsert after MD assign:', subResult.error)
    }
  }

  return NextResponse.json({
    success: true,
    message: `POS machine ${machine.machine_id} assigned to Master Distributor ${md.name}`,
  })
}

// ─── Master Distributor → Distributor ───────────────────────

async function assignToDistributor(
  supabase: any, request: NextRequest, user: any,
  machine: any, assignTo: string, notes: string | undefined,
  activeAssignment: any,
  subscriptionAmount: number | null, billingDay: number, gstPercent: number
) {
  if (machine.master_distributor_id !== user.partner_id) {
    return NextResponse.json({ error: 'This machine is not assigned to you' }, { status: 403 })
  }

  if (machine.inventory_status !== 'assigned_to_master_distributor') {
    return NextResponse.json({
      error: `Machine is currently "${machine.inventory_status}". Only machines in your inventory (assigned_to_master_distributor) can be assigned to a Distributor.`
    }, { status: 400 })
  }

  const { data: dist, error: distError } = await supabase
    .from('distributors')
    .select('partner_id, name, status, master_distributor_id')
    .eq('partner_id', assignTo)
    .single()

  if (distError || !dist) {
    return NextResponse.json({ error: 'Invalid Distributor selected' }, { status: 400 })
  }
  if (dist.master_distributor_id !== user.partner_id) {
    return NextResponse.json({ error: 'This Distributor is not under your network' }, { status: 403 })
  }
  if (dist.status !== 'active') {
    return NextResponse.json({ error: 'Distributor is not active' }, { status: 400 })
  }

  // Close any existing active assignment
  await closeActiveAssignment(supabase, machine.id, activeAssignment)

  const { error: updateError } = await supabase
    .from('pos_machines')
    .update({
      distributor_id: assignTo,
      retailer_id: null,
      inventory_status: 'assigned_to_distributor',
      assigned_by: user.partner_id,
      assigned_by_role: 'master_distributor',
      last_assigned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', machine.id)

  if (updateError) {
    console.error('Error assigning machine to Distributor:', updateError)
    return NextResponse.json({ error: 'Failed to assign machine' }, { status: 500 })
  }

  await supabase.from('pos_assignment_history').insert({
    pos_machine_id: machine.id,
    machine_id: machine.machine_id,
    action: 'assigned_to_distributor',
    assigned_by: user.partner_id,
    assigned_by_role: 'master_distributor',
    assigned_to: assignTo,
    assigned_to_role: 'distributor',
    previous_holder: machine.distributor_id || null,
    previous_holder_role: machine.distributor_id ? 'distributor' : null,
    status: 'active',
    notes: notes || `Master Distributor assigned to ${dist.name}`,
  })

  logAssignment(request, user, machine, assignTo, 'distributor')

  if (subscriptionAmount != null && subscriptionAmount > 0) {
    const subResult = await upsertSubscriptionOnAssign({
      supabase,
      assignee_user_id: assignTo,
      assignee_user_role: 'distributor',
      machine: { machine_id: machine.machine_id, retailer_id: null, distributor_id: assignTo, master_distributor_id: machine.master_distributor_id },
      rate_per_unit: subscriptionAmount,
      billing_day: billingDay,
      gst_percent: gstPercent,
      assigned_by: user.partner_id,
      assigned_by_role: 'master_distributor',
    })
    if (!subResult.success) {
      console.error('[Assign] Subscription upsert after Distributor assign:', subResult.error)
    }
  }

  return NextResponse.json({
    success: true,
    message: `POS machine ${machine.machine_id} assigned to Distributor ${dist.name}`,
  })
}

// ─── Distributor → Retailer ─────────────────────────────────

async function assignToRetailer(
  supabase: any, request: NextRequest, user: any,
  machine: any, assignTo: string, notes: string | undefined,
  activeAssignment: any,
  subscriptionAmount: number | null, billingDay: number, gstPercent: number
) {
  if (machine.distributor_id !== user.partner_id) {
    return NextResponse.json({ error: 'This machine is not assigned to you' }, { status: 403 })
  }

  if (machine.inventory_status !== 'assigned_to_distributor') {
    return NextResponse.json({
      error: `Machine is currently "${machine.inventory_status}". Only machines in your inventory (assigned_to_distributor) can be assigned to a Retailer.`
    }, { status: 400 })
  }

  const { data: retailer, error: retailerError } = await supabase
    .from('retailers')
    .select('partner_id, name, status, distributor_id')
    .eq('partner_id', assignTo)
    .single()

  if (retailerError || !retailer) {
    return NextResponse.json({ error: 'Invalid Retailer selected' }, { status: 400 })
  }
  if (retailer.distributor_id !== user.partner_id) {
    return NextResponse.json({ error: 'This Retailer is not under your network' }, { status: 403 })
  }
  if (retailer.status !== 'active') {
    return NextResponse.json({ error: 'Retailer is not active' }, { status: 400 })
  }

  // Prevent assigning if there's already an active assignment to someone else
  if (activeAssignment && activeAssignment.assigned_to !== assignTo) {
    await closeActiveAssignment(supabase, machine.id, activeAssignment)
  }

  const { error: updateError } = await supabase
    .from('pos_machines')
    .update({
      retailer_id: assignTo,
      inventory_status: 'assigned_to_retailer',
      assigned_by: user.partner_id,
      assigned_by_role: 'distributor',
      last_assigned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', machine.id)

  if (updateError) {
    console.error('Error assigning machine to Retailer:', updateError)
    return NextResponse.json({ error: 'Failed to assign machine' }, { status: 500 })
  }

  await supabase.from('pos_assignment_history').insert({
    pos_machine_id: machine.id,
    machine_id: machine.machine_id,
    action: 'assigned_to_retailer',
    assigned_by: user.partner_id,
    assigned_by_role: 'distributor',
    assigned_to: assignTo,
    assigned_to_role: 'retailer',
    previous_holder: machine.retailer_id || null,
    previous_holder_role: machine.retailer_id ? 'retailer' : null,
    status: 'active',
    notes: notes || `Distributor assigned to ${retailer.name}`,
  })

  logAssignment(request, user, machine, assignTo, 'retailer')

  if (subscriptionAmount != null && subscriptionAmount > 0) {
    const subResult = await upsertSubscriptionOnAssign({
      supabase,
      assignee_user_id: assignTo,
      assignee_user_role: 'retailer',
      machine: { machine_id: machine.machine_id, retailer_id: assignTo, distributor_id: machine.distributor_id, master_distributor_id: machine.master_distributor_id },
      rate_per_unit: subscriptionAmount,
      billing_day: billingDay,
      gst_percent: gstPercent,
      assigned_by: user.partner_id,
      assigned_by_role: 'distributor',
    })
    if (!subResult.success) {
      console.error('[Assign] Subscription upsert after Retailer assign:', subResult.error)
    }
  }

  // Update pos_device_mapping for Razorpay transaction visibility
  if (machine.serial_number) {
    const { data: existingMapping } = await supabase
      .from('pos_device_mapping')
      .select('id')
      .eq('device_serial', machine.serial_number)
      .single()

    if (existingMapping) {
      await supabase
        .from('pos_device_mapping')
        .update({
          retailer_id: assignTo,
          distributor_id: user.partner_id,
          master_distributor_id: machine.master_distributor_id,
        })
        .eq('id', existingMapping.id)
    } else {
      await supabase
        .from('pos_device_mapping')
        .insert({
          device_serial: machine.serial_number,
          retailer_id: assignTo,
          distributor_id: user.partner_id,
          master_distributor_id: machine.master_distributor_id,
          status: 'ACTIVE',
        })
    }
  }

  return NextResponse.json({
    success: true,
    message: `POS machine ${machine.machine_id} assigned to Retailer ${retailer.name}`,
  })
}

// ─── Partner POS Machine Sync ───────────────────────────────

async function syncPartnerPosMachine(
  supabase: any, machine: any, partnerId: string, partner: any
) {
  let retailerId: string | null = null
  const { data: existingRetailer } = await supabase
    .from('partner_retailers')
    .select('id')
    .eq('partner_id', partnerId)
    .limit(1)
    .single()

  if (existingRetailer) {
    retailerId = existingRetailer.id
  } else {
    const { data: newRetailer, error: retailerError } = await supabase
      .from('partner_retailers')
      .insert({
        partner_id: partnerId,
        retailer_code: `RET-${partner.name.toUpperCase().replace(/\s+/g, '-')}-001`,
        name: `${partner.name} Default Retailer`,
        business_name: partner.business_name || partner.name,
        status: 'active',
      })
      .select('id')
      .single()

    if (!retailerError && newRetailer) {
      retailerId = newRetailer.id
    }
  }

  if (machine.tid) {
    const { data: existingPartnerMachine } = await supabase
      .from('partner_pos_machines')
      .select('id')
      .eq('terminal_id', machine.tid)
      .single()

    const partnerMachineData: any = {
      partner_id: partnerId,
      retailer_id: retailerId,
      terminal_id: machine.tid,
      device_serial: machine.serial_number || null,
      machine_model: machine.brand === 'RAZORPAY' ? 'Razorpay POS' : machine.brand || 'POS',
      status: machine.status === 'active' ? 'active' : 'inactive',
      activated_at: machine.installation_date || new Date().toISOString(),
      metadata: machine.mid ? { mid: machine.mid } : {},
    }

    if (existingPartnerMachine) {
      await supabase
        .from('partner_pos_machines')
        .update(partnerMachineData)
        .eq('id', existingPartnerMachine.id)
    } else {
      await supabase
        .from('partner_pos_machines')
        .insert(partnerMachineData)
    }
  }
}
