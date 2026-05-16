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
  activeAssignment: any,
  assignedDate?: string
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

  const effectiveDate = assignedDate || new Date().toISOString()
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
    assigned_date: effectiveDate,
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
  gstPercent: number,
  assignedDate?: string
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

  const effectiveDateMd = assignedDate || new Date().toISOString()
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
    assigned_date: effectiveDateMd,
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

// adminAssignOneToDistributor and adminAssignOneToRetailer removed:
// Admin can only assign to MD or Partner. Distributors are assigned by MDs, Retailers by Distributors.
