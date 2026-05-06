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
 * For each transaction, returns the assignee who held the POS machine
 * at the time of the transaction. Falls back to the current pos_machines
 * assignment only when no history rows exist for that TID.
 */
export async function resolveTransactionAssignments(
  supabase: SupabaseClient,
  transactions: { txn_id: string; tid: string | null; transaction_time: string }[]
): Promise<Record<string, AssignmentResult>> {
  const result: Record<string, AssignmentResult> = {}
  const uniqueTids = Array.from(new Set(transactions.map(t => t.tid).filter(Boolean))) as string[]

  if (uniqueTids.length === 0) {
    for (const txn of transactions) {
      result[txn.txn_id] = { assigned_name: null, assigned_type: null }
    }
    return result
  }

  // 1. Fetch pos_machines in batches
  const posMachineMap: Record<string, any> = {}
  const machineIdToTid = new Map<string, string>()
  const allMachineIds: string[] = []

  for (let i = 0; i < uniqueTids.length; i += BATCH_SIZE) {
    const batch = uniqueTids.slice(i, i + BATCH_SIZE)
    const { data: posMachines } = await supabase
      .from('pos_machines')
      .select('id, tid, retailer_id, distributor_id, master_distributor_id, partner_id')
      .in('tid', batch)

    if (posMachines) {
      for (const pm of posMachines) {
        if (pm.tid) {
          posMachineMap[pm.tid] = pm
          machineIdToTid.set(pm.id, pm.tid)
          allMachineIds.push(pm.id)
        }
      }
    }
  }

  // 2. Fetch assignment history in batches
  const tidToAssignments: Record<string, AssignmentWindow[]> = {}

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
          const tid = machineIdToTid.get(h.pos_machine_id)
          if (!tid) continue
          if (!tidToAssignments[tid]) tidToAssignments[tid] = []
          tidToAssignments[tid].push({
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

  for (const tid in tidToAssignments) {
    for (const a of tidToAssignments[tid]) {
      switch (a.assigned_to_role) {
        case 'retailer': retailerIds.add(a.assigned_to); break
        case 'distributor': distributorIds.add(a.assigned_to); break
        case 'master_distributor': masterDistributorIds.add(a.assigned_to); break
        case 'partner': partnerIds.add(a.assigned_to); break
      }
    }
  }

  // Include current assignment IDs as fallback for machines with no history
  for (const pm of Object.values(posMachineMap)) {
    if (pm.retailer_id) retailerIds.add(pm.retailer_id)
    if (pm.distributor_id) distributorIds.add(pm.distributor_id)
    if (pm.master_distributor_id) masterDistributorIds.add(pm.master_distributor_id)
    if (pm.partner_id) partnerIds.add(pm.partner_id)
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

  for (const txn of transactions) {
    let assignedName: string | null = null
    let assignedType: string | null = null

    if (txn.tid && tidToAssignments[txn.tid]) {
      const txTime = new Date(txn.transaction_time)
      const match = tidToAssignments[txn.tid].find(
        a => txTime >= a.from && (!a.to || txTime <= a.to)
      )
      if (match) {
        assignedName = nameFromRole(match.assigned_to, match.assigned_to_role)
        assignedType = match.assigned_to_role
      }
    }

    // Fallback: use current pos_machines only when NO history exists for this TID
    if (!assignedName && txn.tid && !tidToAssignments[txn.tid]) {
      const pm = posMachineMap[txn.tid]
      if (pm) {
        if (pm.retailer_id) {
          assignedName = nameFromRole(pm.retailer_id, 'retailer')
          assignedType = 'retailer'
        } else if (pm.distributor_id) {
          assignedName = nameFromRole(pm.distributor_id, 'distributor')
          assignedType = 'distributor'
        } else if (pm.master_distributor_id) {
          assignedName = nameFromRole(pm.master_distributor_id, 'master_distributor')
          assignedType = 'master_distributor'
        } else if (pm.partner_id) {
          assignedName = nameFromRole(pm.partner_id, 'partner')
          assignedType = 'partner'
        }
      }
    }

    result[txn.txn_id] = { assigned_name: assignedName, assigned_type: assignedType }
  }

  return result
}
