// Server-only: resolve the set of partner_ids a user is allowed to see.
// Used by report endpoints to enforce hierarchy scoping (prevent cross-network
// data leakage). Admin / finance_executive get an empty (unrestricted) result.

export interface DownlineInfo {
  retailerIds: string[]
  distributorIds: string[]
  mdIds: string[]
}

export function isPrivilegedRole(role: unknown): boolean {
  return role === 'admin' || role === 'finance_executive'
}

export async function resolveDownline(supabase: any, user: any): Promise<DownlineInfo> {
  const info: DownlineInfo = { retailerIds: [], distributorIds: [], mdIds: [] }

  if (isPrivilegedRole(user?.role)) {
    return info // full network view — no filtering needed
  }

  if (user.role === 'master_distributor' && user.partner_id) {
    const { data: dists } = await supabase
      .from('distributors')
      .select('partner_id')
      .eq('master_distributor_id', user.partner_id)
    info.distributorIds = (dists || []).map((d: any) => d.partner_id)

    const distFilter = info.distributorIds.length > 0
      ? `master_distributor_id.eq.${user.partner_id},distributor_id.in.(${info.distributorIds.join(',')})`
      : `master_distributor_id.eq.${user.partner_id}`
    const { data: rets } = await supabase
      .from('retailers')
      .select('partner_id')
      .or(distFilter)
    info.retailerIds = (rets || []).map((r: any) => r.partner_id)
    info.mdIds = [user.partner_id]
  }

  if (user.role === 'distributor' && user.partner_id) {
    const { data: rets } = await supabase
      .from('retailers')
      .select('partner_id')
      .eq('distributor_id', user.partner_id)
    info.retailerIds = (rets || []).map((r: any) => r.partner_id)
    info.distributorIds = [user.partner_id]
  }

  if (user.role === 'retailer' && user.partner_id) {
    info.retailerIds = [user.partner_id]
  }

  return info
}

/**
 * Flattened set of every partner_id the user may see (self + downline).
 * Empty array returned for privileged roles is meaningless — callers must check
 * isPrivilegedRole first and skip filtering for them.
 */
export function downlineToIdSet(info: DownlineInfo, selfPartnerId?: string | null): string[] {
  const ids = new Set<string>()
  info.retailerIds.forEach((id) => id && ids.add(id))
  info.distributorIds.forEach((id) => id && ids.add(id))
  info.mdIds.forEach((id) => id && ids.add(id))
  if (selfPartnerId) ids.add(selfPartnerId)
  return Array.from(ids)
}
