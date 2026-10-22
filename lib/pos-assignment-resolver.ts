import { SupabaseClient } from '@supabase/supabase-js'

export interface AssignmentResult {
  assigned_name: string | null
  assigned_type: string | null
}

interface AssignmentWindow {
  assigned_to: string
  assigned_to_role: string
  from: Date
  to: Date | null
}

const BATCH_SIZE = 50

/**
 * Resolve partner/retailer/distributor/MD names for transactions
 * using time-aware pos_assignment_history windows.
 *
 * Resolution order:
 *   1. pos_assignment_history — time-window match on TID
 *   2. pos_assignment_history — latest active / most recent record for TID
 *   3. pos_machines — current assignment by TID
 *   4. pos_machines — current assignment by device serial (serial_number)
 *   5. pos_device_mapping — retailer_id by device serial
 */
export async function resolveTransactionAssignments(
  supabase: SupabaseClient,
  transactions: { txn_id: string; tid: string | null; transaction_time: string; device_serial?: string | null }[]
): Promise<Record<string, AssignmentResult>> {
  const result: Record<string, AssignmentResult> = {}
  const uniqueTids = Array.from(new Set(transactions.map(t => t.tid).filter(Boolean))) as string[]
  const uniqueSerials = Array.from(new Set(transactions.map(t => t.device_serial).filter(Boolean))) as string[]

  if (uniqueTids.length === 0 && uniqueSerials.length === 0) {
    for (const txn of transactions) {
      result[txn.txn_id] = { assigned_name: null, assigned_type: null }
    }
    return result
  }

  // 1. Fetch pos_machines by TID in batches
  const posMachineByTid: Record<string, any> = {}
  const posMachineBySerial: Record<string, any> = {}
  const machineIdToKey = new Map<string, string>() // machine UUID → TID (or serial)
  const allMachineIds: string[] = []

  for (let i = 0; i < uniqueTids.length; i += BATCH_SIZE) {
    const batch = uniqueTids.slice(i, i + BATCH_SIZE)
    const { data: posMachines } = await supabase
      .from('pos_machines')
      .select('id, tid, serial_number, retailer_id, distributor_id, master_distributor_id, partner_id')
      .in('tid', batch)

    if (posMachines) {
      for (const pm of posMachines) {
        if (pm.tid) {
          posMachineByTid[pm.tid] = pm
          machineIdToKey.set(pm.id, pm.tid)
          allMachineIds.push(pm.id)
        }
      }
    }
  }

  // 1b. Fetch pos_machines by serial_number for TIDs we didn't find
  const unresolvedSerials = uniqueSerials.filter(s => {
    // Only look up serials whose transactions didn't already resolve via TID
    return !transactions.some(t => t.device_serial === s && t.tid && posMachineByTid[t.tid])
  })

  if (unresolvedSerials.length > 0) {
    for (let i = 0; i < unresolvedSerials.length; i += BATCH_SIZE) {
      const batch = unresolvedSerials.slice(i, i + BATCH_SIZE)
      const { data: posMachines } = await supabase
        .from('pos_machines')
        .select('id, tid, serial_number, retailer_id, distributor_id, master_distributor_id, partner_id')
        .in('serial_number', batch)

      if (posMachines) {
        for (const pm of posMachines) {
          if (pm.serial_number) {
            posMachineBySerial[pm.serial_number] = pm
            if (!machineIdToKey.has(pm.id)) {
              machineIdToKey.set(pm.id, pm.serial_number)
              allMachineIds.push(pm.id)
            }
          }
        }
      }
    }
  }

  // 2. Fetch assignment history in batches
  const keyToAssignments: Record<string, AssignmentWindow[]> = {}

  if (allMachineIds.length > 0) {
    for (let i = 0; i < allMachineIds.length; i += BATCH_SIZE) {
      const batch = allMachineIds.slice(i, i + BATCH_SIZE)
      const { data: history } = await supabase
        .from('pos_assignment_history')
        .select('pos_machine_id, assigned_to, assigned_to_role, created_at, returned_date, status')
        .in('pos_machine_id', batch)
        .like('action', 'assigned_to_%')
        .order('created_at', { ascending: false })

      if (history) {
        for (const h of history) {
          const key = machineIdToKey.get(h.pos_machine_id)
          if (!key) continue
          if (!keyToAssignments[key]) keyToAssignments[key] = []
          keyToAssignments[key].push({
            assigned_to: h.assigned_to,
            assigned_to_role: h.assigned_to_role,
            from: new Date(h.created_at),
            to: h.returned_date ? new Date(h.returned_date) : null,
          })
        }
      }
    }
  }

  // 3. Collect all unique assignee IDs by role
  const retailerIds = new Set<string>()
  const distributorIds = new Set<string>()
  const masterDistributorIds = new Set<string>()
  const partnerIds = new Set<string>()

  for (const key in keyToAssignments) {
    for (const a of keyToAssignments[key]) {
      switch (a.assigned_to_role) {
        case 'retailer': retailerIds.add(a.assigned_to); break
        case 'distributor': distributorIds.add(a.assigned_to); break
        case 'master_distributor': masterDistributorIds.add(a.assigned_to); break
        case 'partner': partnerIds.add(a.assigned_to); break
      }
    }
  }

  // Include current assignment IDs from pos_machines
  for (const pm of [...Object.values(posMachineByTid), ...Object.values(posMachineBySerial)]) {
    if (pm.retailer_id) retailerIds.add(pm.retailer_id)
    if (pm.distributor_id) distributorIds.add(pm.distributor_id)
    if (pm.master_distributor_id) masterDistributorIds.add(pm.master_distributor_id)
    if (pm.partner_id) partnerIds.add(pm.partner_id)
  }

  // 3b. Fetch pos_device_mapping for unresolved serials (retailer_id only)
  const deviceMappingBySerial: Record<string, any> = {}
  if (uniqueSerials.length > 0) {
    for (let i = 0; i < uniqueSerials.length; i += BATCH_SIZE) {
      const batch = uniqueSerials.slice(i, i + BATCH_SIZE)
      const { data: mappings } = await supabase
        .from('pos_device_mapping')
        .select('device_serial, retailer_id, distributor_id, master_distributor_id')
        .in('device_serial', batch)
        .eq('status', 'ACTIVE')

      if (mappings) {
        for (const m of mappings) {
          if (m.device_serial) {
            deviceMappingBySerial[m.device_serial] = m
            if (m.retailer_id) retailerIds.add(m.retailer_id)
            if (m.distributor_id) distributorIds.add(m.distributor_id)
            if (m.master_distributor_id) masterDistributorIds.add(m.master_distributor_id)
          }
        }
      }
    }
  }

  // 4. Fetch name maps in batches
  const retailerMap: Record<string, any> = {}
  const distributorMap: Record<string, any> = {}
  const masterDistributorMap: Record<string, any> = {}
  const partnerMap: Record<string, any> = {}

  const fetchNameBatches = async (
    table: string,
    idField: string,
    ids: string[],
    map: Record<string, any>
  ) => {
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE)
      const { data } = await supabase
        .from(table)
        .select(`${idField}, name, business_name`)
        .in(idField, batch)
      if (data) {
        for (const row of data) {
          const key = (row as Record<string, any>)[idField]
          if (key) map[key] = row
        }
      }
    }
  }

  await Promise.all([
    retailerIds.size > 0 ? fetchNameBatches('retailers', 'partner_id', Array.from(retailerIds), retailerMap) : Promise.resolve(),
    distributorIds.size > 0 ? fetchNameBatches('distributors', 'partner_id', Array.from(distributorIds), distributorMap) : Promise.resolve(),
    masterDistributorIds.size > 0 ? fetchNameBatches('master_distributors', 'partner_id', Array.from(masterDistributorIds), masterDistributorMap) : Promise.resolve(),
    partnerIds.size > 0 ? fetchNameBatches('partners', 'id', Array.from(partnerIds), partnerMap) : Promise.resolve(),
  ])

  // 5. Resolve per transaction
  const nameFromRole = (id: string, role: string): string | null => {
    switch (role) {
      case 'retailer': return retailerMap[id]?.name || retailerMap[id]?.business_name || null
      case 'distributor': return distributorMap[id]?.name || distributorMap[id]?.business_name || null
      case 'master_distributor': return masterDistributorMap[id]?.name || masterDistributorMap[id]?.business_name || null
      case 'partner': return partnerMap[id]?.name || partnerMap[id]?.business_name || null
      default: return null
    }
  }

  const resolveFromMachine = (pm: any): { name: string | null; type: string | null } => {
    if (pm.retailer_id) {
      const n = nameFromRole(pm.retailer_id, 'retailer')
      if (n) return { name: n, type: 'retailer' }
    }
    if (pm.distributor_id) {
      const n = nameFromRole(pm.distributor_id, 'distributor')
      if (n) return { name: n, type: 'distributor' }
    }
    if (pm.master_distributor_id) {
      const n = nameFromRole(pm.master_distributor_id, 'master_distributor')
      if (n) return { name: n, type: 'master_distributor' }
    }
    if (pm.partner_id) {
      const n = nameFromRole(pm.partner_id, 'partner')
      if (n) return { name: n, type: 'partner' }
    }
    return { name: null, type: null }
  }

  for (const txn of transactions) {
    let assignedName: string | null = null
    let assignedType: string | null = null

    // Determine the lookup key (TID or serial) and the assignment list
    const lookupKey = txn.tid || (txn.device_serial ? txn.device_serial : null)
    const assignments = txn.tid ? keyToAssignments[txn.tid] : (txn.device_serial ? keyToAssignments[txn.device_serial] : undefined)

    // A. Time-aware history match
    if (assignments && assignments.length > 0) {
      const txTime = new Date(txn.transaction_time)
      const match = assignments.find(
        a => txTime >= a.from && (!a.to || txTime <= a.to)
      )
      if (match) {
        assignedName = nameFromRole(match.assigned_to, match.assigned_to_role)
        assignedType = match.assigned_to_role
      } else {
        // No exact window: use latest active or most recent record
        const latestActive = assignments.find(a => !a.to)
        const fallback = latestActive || assignments[0]
        if (fallback) {
          assignedName = nameFromRole(fallback.assigned_to, fallback.assigned_to_role)
          assignedType = fallback.assigned_to_role
        }
      }
    }

    // B. Fallback: current pos_machines assignment by TID
    if (!assignedName && txn.tid) {
      const pm = posMachineByTid[txn.tid]
      if (pm) {
        const r = resolveFromMachine(pm)
        assignedName = r.name
        assignedType = r.type
      }
    }

    // C. Fallback: current pos_machines assignment by serial_number
    if (!assignedName && txn.device_serial) {
      const pm = posMachineBySerial[txn.device_serial]
      if (pm) {
        const r = resolveFromMachine(pm)
        assignedName = r.name
        assignedType = r.type
      }
    }

    // D. Fallback: pos_device_mapping by device_serial (retailer_id)
    if (!assignedName && txn.device_serial) {
      const mapping = deviceMappingBySerial[txn.device_serial]
      if (mapping) {
        if (mapping.retailer_id) {
          assignedName = nameFromRole(mapping.retailer_id, 'retailer')
          assignedType = 'retailer'
        }
        if (!assignedName && mapping.distributor_id) {
          assignedName = nameFromRole(mapping.distributor_id, 'distributor')
          assignedType = 'distributor'
        }
        if (!assignedName && mapping.master_distributor_id) {
          assignedName = nameFromRole(mapping.master_distributor_id, 'master_distributor')
          assignedType = 'master_distributor'
        }
      }
    }

    result[txn.txn_id] = { assigned_name: assignedName, assigned_type: assignedType }
  }

  return result
}
