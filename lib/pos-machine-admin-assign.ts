import { NextRequest } from 'next/server'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { upsertSubscriptionOnAssign } from '@/lib/subscription/upsert-subscription-on-assign'

export type AdminSingleAssignResult =
  | { ok: true; message: string }
  | { ok: false; error: string; status: number }

export async function closeActiveAssignment(supabase: any, machineId: string, activeAssignment: any) {
  if (activeAssignment) {
    await supabase
      .from('pos_assignment_history')
      .update({ status: 'returned', returned_date: new Date().toISOString() })
      .eq('id', activeAssignment.id)
  }
}

function logPosMachineAssign(request: NextRequest, user: any, machine: any, targetId: string, targetRole: string) {
  const ctx = getRequestContext(request)
  logActivityFromContext(ctx, user, {
    activity_type: 'pos_machine_assign',
    activity_category: 'pos',
    activity_description: `Assigned POS machine ${machine.machine_id || machine.serial_number} to ${targetRole} ${targetId}`,
    reference_table: 'pos_machines',
    reference_id: machine.id,
  }).catch(() => {})
}

async function removePartnerTerminalRow(supabase: any, machine: any) {
  if (machine.partner_id && machine.tid) {
    await supabase.from('partner_pos_machines').delete().eq('terminal_id', machine.tid)
  }
}

async function syncPartnerPosMachine(supabase: any, machine: any, partnerId: string, partner: any) {
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
      await supabase.from('partner_pos_machines').update(partnerMachineData).eq('id', existingPartnerMachine.id)
    } else {
      await supabase.from('partner_pos_machines').insert(partnerMachineData)
    }
  }
}

export async function adminAssignOneToPartner(
  supabase: any,
  request: NextRequest,
  user: any,
  machine: any,
  assignTo: string,
  notes: string | undefined,
  activeAssignment: any
): Promise<AdminSingleAssignResult> {
  const { data: partner, error: partnerError } = await supabase
    .from('partners')
    .select('id, name, status, business_name')
    .eq('id', assignTo)
    .single()

  if (partnerError || !partner) {
    return { ok: false, error: 'Invalid Partner selected', status: 400 }
  }
  if (partner.status !== 'active') {
    return { ok: false, error: 'Partner is not active', status: 400 }
  }

  await closeActiveAssignment(supabase, machine.id, activeAssignment)

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
    return { ok: false, error: 'Failed to assign machine', status: 500 }
  }

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

  await syncPartnerPosMachine(supabase, machine, assignTo, partner)

  await supabase.from('pos_assignment_history').insert({
    pos_machine_id: machine.id,
    machine_id: machine.machine_id,
    action: 'assigned_to_partner',
    assigned_by: user.email,
    assigned_by_role: 'admin',
    assigned_to: assignTo,
    assigned_to_role: 'partner',
    previous_holder:
      machine.partner_id || machine.retailer_id || machine.distributor_id || machine.master_distributor_id || null,
    previous_holder_role: machine.partner_id
      ? 'partner'
      : machine.retailer_id
        ? 'retailer'
        : machine.distributor_id
          ? 'distributor'
          : machine.master_distributor_id
            ? 'master_distributor'
            : null,
    status: 'active',
    notes: notes || `Admin assigned to Partner ${partner.name}`,
  })

  logPosMachineAssign(request, user, machine, assignTo, 'partner')

  return { ok: true, message: `POS machine ${machine.machine_id} assigned to Partner ${partner.name}` }
}

export async function adminAssignOneToMasterDistributor(
  supabase: any,
  request: NextRequest,
  user: any,
  machine: any,
  assignTo: string,
  notes: string | undefined,
  activeAssignment: any,
  subscriptionAmount: number | null,
  billingDay: number,
  gstPercent: number
): Promise<AdminSingleAssignResult> {
  const { data: md, error: mdError } = await supabase
    .from('master_distributors')
    .select('partner_id, name, status')
    .eq('partner_id', assignTo)
    .single()

  if (mdError || !md) {
    return { ok: false, error: 'Invalid Master Distributor selected', status: 400 }
  }
  if (md.status !== 'active') {
    return { ok: false, error: 'Master Distributor is not active', status: 400 }
  }

  const isReturned = machine.status === 'returned'
  if (!isReturned && machine.inventory_status && !['in_stock', 'received_from_bank'].includes(machine.inventory_status)) {
    return {
      ok: false,
      error: `Machine is currently "${machine.inventory_status}". Only in_stock, received_from_bank, or returned machines can be assigned to a Master Distributor.`,
      status: 400,
    }
  }

  await closeActiveAssignment(supabase, machine.id, activeAssignment)
  await removePartnerTerminalRow(supabase, machine)

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
    return { ok: false, error: 'Failed to assign machine', status: 500 }
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

  logPosMachineAssign(request, user, machine, assignTo, 'master_distributor')

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

  return { ok: true, message: `POS machine ${machine.machine_id} assigned to Master Distributor ${md.name}` }
}

export async function adminAssignOneToDistributor(
  supabase: any,
  request: NextRequest,
  user: any,
  machine: any,
  assignTo: string,
  notes: string | undefined,
  activeAssignment: any,
  subscriptionAmount: number | null,
  billingDay: number,
  gstPercent: number
): Promise<AdminSingleAssignResult> {
  const { data: dist, error: distError } = await supabase
    .from('distributors')
    .select('partner_id, name, status, master_distributor_id')
    .eq('partner_id', assignTo)
    .single()

  if (distError || !dist) {
    return { ok: false, error: 'Invalid Distributor selected', status: 400 }
  }
  if (dist.status !== 'active') {
    return { ok: false, error: 'Distributor is not active', status: 400 }
  }
  if (!dist.master_distributor_id) {
    return { ok: false, error: 'Distributor has no master distributor', status: 400 }
  }

  const fromStock =
    machine.status === 'returned' ||
    ['in_stock', 'received_from_bank'].includes(machine.inventory_status || '')
  const fromMd =
    machine.inventory_status === 'assigned_to_master_distributor' &&
    machine.master_distributor_id === dist.master_distributor_id
  const fromPartner =
    machine.inventory_status === 'assigned_to_partner' && !!machine.partner_id

  if (!fromStock && !fromMd && !fromPartner) {
    return {
      ok: false,
      error: `Machine is "${machine.inventory_status}". Assign to Distributor from stock/bank/returned, from partner, or when already with the same Master Distributor.`,
      status: 400,
    }
  }

  await closeActiveAssignment(supabase, machine.id, activeAssignment)
  await removePartnerTerminalRow(supabase, machine)

  const isReturned = machine.status === 'returned'
  const { error: updateError } = await supabase
    .from('pos_machines')
    .update({
      master_distributor_id: dist.master_distributor_id,
      distributor_id: assignTo,
      retailer_id: null,
      partner_id: null,
      inventory_status: 'assigned_to_distributor',
      status: isReturned ? 'active' : machine.status,
      assigned_by: user.email,
      assigned_by_role: 'admin',
      last_assigned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', machine.id)

  if (updateError) {
    console.error('Error assigning machine to Distributor (admin):', updateError)
    return { ok: false, error: 'Failed to assign machine', status: 500 }
  }

  await supabase.from('pos_assignment_history').insert({
    pos_machine_id: machine.id,
    machine_id: machine.machine_id,
    action: 'assigned_to_distributor',
    assigned_by: user.email,
    assigned_by_role: 'admin',
    assigned_to: assignTo,
    assigned_to_role: 'distributor',
    previous_holder: machine.distributor_id || machine.master_distributor_id || machine.partner_id || null,
    previous_holder_role: machine.distributor_id
      ? 'distributor'
      : machine.master_distributor_id
        ? 'master_distributor'
        : machine.partner_id
          ? 'partner'
          : null,
    status: 'active',
    notes: notes || `Admin assigned to Distributor ${dist.name}`,
  })

  logPosMachineAssign(request, user, machine, assignTo, 'distributor')

  if (subscriptionAmount != null && subscriptionAmount > 0) {
    const subResult = await upsertSubscriptionOnAssign({
      supabase,
      assignee_user_id: assignTo,
      assignee_user_role: 'distributor',
      machine: {
        machine_id: machine.machine_id,
        retailer_id: null,
        distributor_id: assignTo,
        master_distributor_id: dist.master_distributor_id,
      },
      rate_per_unit: subscriptionAmount,
      billing_day: billingDay,
      gst_percent: gstPercent,
      assigned_by: user.partner_id || user.id || user.email,
      assigned_by_role: 'admin',
    })
    if (!subResult.success) {
      console.error('[Assign] Subscription upsert after Distributor assign (admin):', subResult.error)
    }
  }

  return { ok: true, message: `POS machine ${machine.machine_id} assigned to Distributor ${dist.name}` }
}

export async function adminAssignOneToRetailer(
  supabase: any,
  request: NextRequest,
  user: any,
  machine: any,
  assignTo: string,
  notes: string | undefined,
  activeAssignment: any,
  subscriptionAmount: number | null,
  billingDay: number,
  gstPercent: number
): Promise<AdminSingleAssignResult> {
  const { data: retailer, error: retailerError } = await supabase
    .from('retailers')
    .select('partner_id, name, status, distributor_id, master_distributor_id')
    .eq('partner_id', assignTo)
    .single()

  if (retailerError || !retailer) {
    return { ok: false, error: 'Invalid Retailer selected', status: 400 }
  }
  if (retailer.status !== 'active') {
    return { ok: false, error: 'Retailer is not active', status: 400 }
  }
  if (!retailer.distributor_id || !retailer.master_distributor_id) {
    return { ok: false, error: 'Retailer must be linked to a distributor and master distributor', status: 400 }
  }

  const fromStock =
    machine.status === 'returned' ||
    ['in_stock', 'received_from_bank'].includes(machine.inventory_status || '')
  const fromMd =
    machine.inventory_status === 'assigned_to_master_distributor' &&
    machine.master_distributor_id === retailer.master_distributor_id
  const fromDist =
    machine.inventory_status === 'assigned_to_distributor' &&
    machine.distributor_id === retailer.distributor_id
  const fromPartner =
    machine.inventory_status === 'assigned_to_partner' && !!machine.partner_id

  if (!fromStock && !fromMd && !fromDist && !fromPartner) {
    return {
      ok: false,
      error: `Machine is "${machine.inventory_status}". Assign to Retailer from stock/bank/returned, from partner, same Master Distributor, or same Distributor as the retailer.`,
      status: 400,
    }
  }

  await closeActiveAssignment(supabase, machine.id, activeAssignment)

  await removePartnerTerminalRow(supabase, machine)

  const isReturned = machine.status === 'returned'
  const { error: updateError } = await supabase
    .from('pos_machines')
    .update({
      retailer_id: assignTo,
      distributor_id: retailer.distributor_id,
      master_distributor_id: retailer.master_distributor_id,
      partner_id: null,
      inventory_status: 'assigned_to_retailer',
      status: isReturned ? 'active' : machine.status,
      assigned_by: user.email,
      assigned_by_role: 'admin',
      last_assigned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', machine.id)

  if (updateError) {
    console.error('Error assigning machine to Retailer (admin):', updateError)
    return { ok: false, error: 'Failed to assign machine', status: 500 }
  }

  await supabase.from('pos_assignment_history').insert({
    pos_machine_id: machine.id,
    machine_id: machine.machine_id,
    action: 'assigned_to_retailer',
    assigned_by: user.email,
    assigned_by_role: 'admin',
    assigned_to: assignTo,
    assigned_to_role: 'retailer',
    previous_holder: machine.retailer_id || machine.distributor_id || machine.master_distributor_id || machine.partner_id || null,
    previous_holder_role: machine.retailer_id
      ? 'retailer'
      : machine.distributor_id
        ? 'distributor'
        : machine.master_distributor_id
          ? 'master_distributor'
          : machine.partner_id
            ? 'partner'
            : null,
    status: 'active',
    notes: notes || `Admin assigned to Retailer ${retailer.name}`,
  })

  logPosMachineAssign(request, user, machine, assignTo, 'retailer')

  if (subscriptionAmount != null && subscriptionAmount > 0) {
    const subResult = await upsertSubscriptionOnAssign({
      supabase,
      assignee_user_id: assignTo,
      assignee_user_role: 'retailer',
      machine: {
        machine_id: machine.machine_id,
        retailer_id: assignTo,
        distributor_id: retailer.distributor_id,
        master_distributor_id: retailer.master_distributor_id,
      },
      rate_per_unit: subscriptionAmount,
      billing_day: billingDay,
      gst_percent: gstPercent,
      assigned_by: user.partner_id || user.id || user.email,
      assigned_by_role: 'admin',
    })
    if (!subResult.success) {
      console.error('[Assign] Subscription upsert after Retailer assign (admin):', subResult.error)
    }
  }

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
          distributor_id: retailer.distributor_id,
          master_distributor_id: retailer.master_distributor_id,
        })
        .eq('id', existingMapping.id)
    } else {
      await supabase.from('pos_device_mapping').insert({
        device_serial: machine.serial_number,
        retailer_id: assignTo,
        distributor_id: retailer.distributor_id,
        master_distributor_id: retailer.master_distributor_id,
        status: 'ACTIVE',
      })
    }
  }

  return { ok: true, message: `POS machine ${machine.machine_id} assigned to Retailer ${retailer.name}` }
}
