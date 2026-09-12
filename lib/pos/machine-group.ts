import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Avika POS "fleet" grouping — separates transactions by the acquiring machine
 * batch (HDFC vs Axis), both routed through Pine Labs under merchant_slug=avika.
 *
 * Single source of truth: `pos_machines.brand` keyed by TID. This is resolved at
 * read-time (no stored column / no backfill), so newly-registered or re-tagged
 * machines are reflected immediately with zero gaps.
 */
export const AVIKA_AXIS = 'AVIKA-AXIS'
export const AVIKA_HDFC = 'AVIKA-HDFC'
export const MACHINE_GROUPS = [AVIKA_AXIS, AVIKA_HDFC] as const
export type MachineGroup = (typeof MACHINE_GROUPS)[number]

export function isMachineGroup(v: string | null | undefined): v is MachineGroup {
  return v === AVIKA_AXIS || v === AVIKA_HDFC
}

/** Human-friendly label for a fleet group. */
export function machineGroupLabel(group: MachineGroup): string {
  return group === AVIKA_AXIS ? 'Avika-Axis' : 'Avika-HDFC'
}

/**
 * Fetch the set of TIDs belonging to Axis-acquired POS machines. Because this
 * reads `pos_machines` live, adding the next batch of Axis machines needs no code
 * or data migration — their transactions are classified automatically.
 */
export async function getAxisTidSet(supabase: SupabaseClient): Promise<Set<string>> {
  const tids = new Set<string>()
  const PAGE = 1000
  let from = 0
  // Match ONLY the Avika-Axis fleet (e.g. 'AVIKA-AXIS'). Deliberately NOT a bare
  // '%AXIS%' — that also matches ~150 unrelated Razorpay 'AXIS' machines that
  // belong to other companies and must not be folded into the Avika split.
  for (;;) {
    const { data, error } = await supabase
      .from('pos_machines')
      .select('tid')
      .ilike('brand', '%AVIKA-AXIS%')
      .not('tid', 'is', null)
      .range(from, from + PAGE - 1)

    if (error || !data || data.length === 0) break
    for (const m of data as Array<{ tid: string | null }>) {
      const t = m.tid ? String(m.tid).trim() : ''
      if (t) tids.add(t)
    }
    if (data.length < PAGE) break
    from += PAGE
  }
  return tids
}

/**
 * Resolve the fleet a transaction belongs to. Only Avika transactions are split;
 * every other company returns null so their display is unchanged.
 *  - TID registered as an Axis machine → AVIKA-AXIS
 *  - any other Avika transaction (incl. null TID) → AVIKA-HDFC (legacy fleet)
 */
export function resolveMachineGroup(opts: {
  merchantSlug: string | null | undefined
  tid: string | null | undefined
  axisTids: Set<string>
}): MachineGroup | null {
  const slug = (opts.merchantSlug || '').toLowerCase().trim()
  if (slug !== 'avika') return null
  const tid = opts.tid ? String(opts.tid).trim() : ''
  if (tid && opts.axisTids.has(tid)) return AVIKA_AXIS
  return AVIKA_HDFC
}

/**
 * Apply a fleet filter to a PostgREST query builder. Scopes to Avika and
 * partitions by the Axis TID set (HDFC = everything else, including null TIDs).
 * Returns the same builder type so it chains with existing filters.
 */
export function applyMachineGroupFilter<T>(query: T, group: MachineGroup, axisTids: Set<string>): T {
  const list = Array.from(axisTids)
  // Fleet grouping only exists within Avika.
  let q: any = (query as any).eq('merchant_slug', 'avika')

  if (group === AVIKA_AXIS) {
    if (list.length === 0) {
      // No Axis machines registered → there can be no Axis transactions.
      q = q.is('tid', null).not('tid', 'is', null) // deliberately empty
    } else {
      q = q.in('tid', list)
    }
  } else {
    // AVIKA-HDFC = Avika rows that are NOT on an Axis TID (null TID = legacy HDFC).
    if (list.length > 0) {
      const inList = `(${list.map((t) => `"${t}"`).join(',')})`
      q = q.or(`tid.is.null,tid.not.in.${inList}`)
    }
    // list empty → every Avika row is HDFC; merchant_slug scope is sufficient.
  }
  return q as T
}
