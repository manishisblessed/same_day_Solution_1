import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Fetch TIDs (Terminal IDs) for POS machines that are/were assigned to users
 * matching the given role and/or name filter.
 *
 * Used to pre-filter transaction queries at the DB level before running the
 * time-aware resolveTransactionAssignments pass.
 *
 * Returns:
 *  - null  → no filter applied (both role and name are empty)
 *  - []    → no machines found — caller should short-circuit with 0 results
 *  - [...] → list of matching TIDs to use with .in('tid', tids)
 */

const VALID_ROLES = ['partner', 'retailer', 'distributor', 'master_distributor'] as const
export type AssignedRole = (typeof VALID_ROLES)[number]

interface RoleTableDef {
  table: string
  idField: string   // primary key field of the user table
  machineCol: string // FK column on pos_machines pointing to this role
}

export const ROLE_TABLE_MAP: Record<AssignedRole, RoleTableDef> = {
  partner:            { table: 'partners',            idField: 'id',         machineCol: 'partner_id' },
  retailer:           { table: 'retailers',           idField: 'partner_id', machineCol: 'retailer_id' },
  distributor:        { table: 'distributors',        idField: 'partner_id', machineCol: 'distributor_id' },
  master_distributor: { table: 'master_distributors', idField: 'partner_id', machineCol: 'master_distributor_id' },
}

const BATCH = 100
const TID_LIMIT = 1000 // max TIDs to pass in a single .in() filter

/** Safely escape ILIKE wildcards from user input. */
function escapeLike(s: string) {
  return s.replace(/[%_\\]/g, '\\$&')
}

/** Fetch TIDs from pos_machines for an array of machine IDs (in batches). */
async function getTidsFromMachineIds(supabase: SupabaseClient, machineIds: string[]): Promise<string[]> {
  const tids: string[] = []
  const unique = [...new Set(machineIds)]
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH)
    const { data } = await supabase
      .from('pos_machines')
      .select('tid')
      .in('id', batch)
      .not('tid', 'is', null)
      .limit(BATCH * 5)
    if (data) data.forEach((m: any) => m.tid && tids.push(m.tid))
  }
  return tids
}

export async function fetchTidsForAssignment(
  supabase: SupabaseClient,
  roleParam: string | null,
  nameParam: string | null
): Promise<string[] | null> {
  const roleFilter = (roleParam && VALID_ROLES.includes(roleParam as AssignedRole))
    ? (roleParam as AssignedRole)
    : null
  const nameFilter = nameParam ? nameParam.trim() : null

  // Nothing to filter on → return null so callers skip the filter entirely
  if (!roleFilter && !nameFilter) return null

  const tidSet = new Set<string>()

  // ── Path A: name search (with optional role narrowing) ──────────────────────
  if (nameFilter) {
    const like = `%${escapeLike(nameFilter)}%`
    const targets = roleFilter ? [roleFilter] : ([...VALID_ROLES] as AssignedRole[])

    // Find matching user IDs in relevant tables
    const matchedIds: { id: string; role: AssignedRole; machineCol: string }[] = []
    for (const r of targets) {
      const { table, idField, machineCol } = ROLE_TABLE_MAP[r]
      const { data } = await supabase
        .from(table)
        .select(`${idField}, name, business_name`)
        .or(`name.ilike.${like},business_name.ilike.${like}`)
        .limit(300)
      if (data) {
        for (const row of data) {
          const id = (row as any)[idField]
          if (id) matchedIds.push({ id, role: r, machineCol })
        }
      }
    }

    if (matchedIds.length === 0) return [] // name matched nothing → zero results

    // Resolve TIDs via current pos_machines + historical assignments
    for (let i = 0; i < matchedIds.length; i += BATCH) {
      const batch = matchedIds.slice(i, i + BATCH)

      // 1. Current machine assignments
      const conds = batch.map(({ id, machineCol }) => `${machineCol}.eq.${id}`).join(',')
      const { data: currMachines } = await supabase
        .from('pos_machines')
        .select('tid')
        .or(conds)
        .limit(TID_LIMIT)
      if (currMachines) currMachines.forEach((m: any) => m.tid && tidSet.add(m.tid))

      // 2. Historical assignment records
      const ids = batch.map((b) => b.id)
      const roleNames = [...new Set(batch.map((b) => b.role))]
      let histQ = supabase
        .from('pos_assignment_history')
        .select('pos_machine_id')
        .in('assigned_to', ids)
        .limit(TID_LIMIT * 2)
      // Narrow by role when all matched IDs share the same role
      if (roleNames.length === 1) histQ = histQ.eq('assigned_to_role', roleNames[0])
      const { data: hist } = await histQ
      if (hist && hist.length > 0) {
        const histMachineIds = hist.map((h: any) => h.pos_machine_id)
        const histTids = await getTidsFromMachineIds(supabase, histMachineIds)
        histTids.forEach((t) => tidSet.add(t))
      }

      // Stop early if already over the TID limit (shouldn't normally happen)
      if (tidSet.size >= TID_LIMIT) break
    }

    return [...tidSet].slice(0, TID_LIMIT)
  }

  // ── Path B: role-only filter (no name) ────────────────────────────────────
  if (roleFilter) {
    const { machineCol } = ROLE_TABLE_MAP[roleFilter]

    // 1. Current machines with this role column populated
    const { data: currMachines } = await supabase
      .from('pos_machines')
      .select('id, tid')
      .not(machineCol, 'is', null)
      .limit(TID_LIMIT * 3)
    if (currMachines) {
      currMachines.forEach((m: any) => m.tid && tidSet.add(m.tid))
    }

    // 2. Historical assignment records for this role
    const { data: hist } = await supabase
      .from('pos_assignment_history')
      .select('pos_machine_id')
      .eq('assigned_to_role', roleFilter)
      .limit(TID_LIMIT * 3)
    if (hist && hist.length > 0) {
      const histMachineIds = hist.map((h: any) => h.pos_machine_id)
      const histTids = await getTidsFromMachineIds(supabase, histMachineIds)
      histTids.forEach((t) => tidSet.add(t))
    }

    // If no TIDs found at all → no machines ever assigned to this role
    return tidSet.size > 0 ? [...tidSet].slice(0, TID_LIMIT) : []
  }

  return null
}
