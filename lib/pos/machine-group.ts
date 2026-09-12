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
/**
 * Build a single PostgREST `.or(...)` expression for a mixed set of selection
 * tokens — real company slugs (ashvam, teachway, …) AND/OR fleet tokens
 * (AVIKA-HDFC / AVIKA-AXIS). Fleets are expressed as nested `and(merchant_slug=avika, …)`
 * so a fleet can be OR-ed alongside other companies in one query.
 *
 * Pure-slug token lists produce the same conditions the legacy code did, so
 * callers can route through this only when a fleet token is present.
 */
export function buildCompanyFilterOr(tokens: string[], axisTids: Set<string>): string {
  const list = Array.from(axisTids)
  const inList = `(${list.map((t) => `"${t}"`).join(',')})`
  const parts: string[] = []
  for (const raw of tokens) {
    const tok = (raw || '').trim()
    if (!tok) continue
    if (tok === AVIKA_AXIS) {
      parts.push(list.length
        ? `and(merchant_slug.eq.avika,tid.in.${inList})`
        : `and(merchant_slug.eq.avika,tid.eq.__no_axis__)`)
    } else if (tok === AVIKA_HDFC) {
      parts.push(list.length
        ? `and(merchant_slug.eq.avika,or(tid.is.null,tid.not.in.${inList}))`
        : `merchant_slug.eq.avika`)
    } else if (tok === 'ashvam') {
      // ashvam = explicit slug OR legacy null slug.
      parts.push('merchant_slug.eq.ashvam')
      parts.push('merchant_slug.is.null')
    } else {
      parts.push(`merchant_slug.eq.${tok}`)
    }
  }
  return parts.join(',')
}

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
