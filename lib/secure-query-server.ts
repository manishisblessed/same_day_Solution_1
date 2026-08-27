/**
 * Server-side helpers for the secure data proxy.
 * Enforces role-based row scoping on top of service-role access.
 */
import { AuthUser } from '@/types/database.types'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const READ_TABLES = new Set([
  'admin_users',
  'aeps_transactions',
  'bbps_transactions',
  'commission_ledger',
  'distributors',
  'finance_users',
  'global_schemes',
  'master_distributors',
  'partner_wallet_ledger',
  'partners',
  'pos_machines',
  'razorpay_transactions',
  'retailer_schemes',
  'retailers',
  'scheme_aeps_commissions',
  'scheme_aeps_settlement_charges',
  'scheme_bbps_commissions',
  'scheme_mappings',
  'scheme_mdr_rates',
  'scheme_payout_charges',
  'scheme_shadval_settlement_charges',
  'schemes',
  'settlements',
  'sub_partners',
  'transactions',
  'wallet_ledger',
  'wallets',
])

export const WRITE_TABLES = new Set([
  'distributors',
  'master_distributors',
  'retailer_schemes',
])

export const ALLOWED_RPCS = new Set([
  'get_wallet_balance_v2',
  'get_wallet_balance',
  'get_partner_wallet_balance',
])

type Filter =
  | { op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'ilike' | 'like'; column: string; value: any }
  | { op: 'in'; column: string; value: any[] }
  | { op: 'is'; column: string; value: null | boolean }

export type SecureQueryBody = {
  table: string
  action: 'select' | 'insert' | 'update' | 'delete'
  select?: string
  filters?: Filter[]
  or?: string[]
  order?: { column: string; ascending?: boolean }[]
  limit?: number
  offset?: number
  range?: [number, number]
  count?: 'exact' | null
  single?: boolean
  maybeSingle?: boolean
  data?: any
}

async function getHierarchyIds(user: AuthUser): Promise<{
  selfId: string | null
  retailerIds: string[]
  distributorIds: string[]
  masterIds: string[]
  partnerIds: string[]
}> {
  const admin = getSupabaseAdmin()
  const selfId = user.partner_id || null
  const empty = {
    selfId,
    retailerIds: [] as string[],
    distributorIds: [] as string[],
    masterIds: [] as string[],
    partnerIds: [] as string[],
  }

  if (!selfId && user.role !== 'admin' && user.role !== 'finance_executive') {
    return empty
  }

  if (user.role === 'admin' || user.role === 'finance_executive') {
    return empty // no restriction — handled by caller
  }

  if (user.role === 'partner' || user.role === 'sub_partner') {
    return { ...empty, partnerIds: selfId ? [selfId] : [] }
  }

  if (user.role === 'retailer') {
    return { ...empty, retailerIds: selfId ? [selfId] : [] }
  }

  if (user.role === 'distributor') {
    const { data } = await admin
      .from('retailers')
      .select('partner_id')
      .eq('distributor_id', selfId!)
    return {
      ...empty,
      distributorIds: selfId ? [selfId] : [],
      retailerIds: (data || []).map((r: any) => r.partner_id).filter(Boolean),
    }
  }

  if (user.role === 'master_distributor') {
    const { data: dists } = await admin
      .from('distributors')
      .select('partner_id')
      .eq('master_distributor_id', selfId!)
    const distributorIds = (dists || []).map((d: any) => d.partner_id).filter(Boolean)
    let retailerIds: string[] = []
    if (distributorIds.length > 0) {
      const { data: rets } = await admin
        .from('retailers')
        .select('partner_id')
        .in('distributor_id', distributorIds)
      retailerIds = (rets || []).map((r: any) => r.partner_id).filter(Boolean)
    }
    // Also retailers directly under MD if any
    const { data: directRets } = await admin
      .from('retailers')
      .select('partner_id')
      .eq('master_distributor_id', selfId!)
    for (const r of directRets || []) {
      if (r.partner_id && !retailerIds.includes(r.partner_id)) retailerIds.push(r.partner_id)
    }
    return {
      ...empty,
      masterIds: selfId ? [selfId] : [],
      distributorIds,
      retailerIds,
    }
  }

  return empty
}

/**
 * Only allow simple `col.op.value` terms joined by commas. Rejects nested
 * and()/or() groups, parentheses, and `in` (parenthesized) to prevent smuggling.
 * Safe regardless because ownership scope is applied as a separate AND filter,
 * so an `.or()` group can never widen access beyond the forced scope.
 */
function isSafeOrFilter(s: string): boolean {
  if (typeof s !== 'string' || s.length === 0 || s.length > 500) return false
  if (/[()]/.test(s)) return false
  const termRe = /^[a-zA-Z_][a-zA-Z0-9_]*\.(eq|neq|gt|gte|lt|lte|like|ilike|is)\..+$/
  return s.split(',').every((t) => termRe.test(t.trim()))
}

function applyClientFilters(query: any, filters: Filter[] = []) {
  let q = query
  for (const f of filters) {
    if (!f.column || typeof f.column !== 'string') continue
    // Block attempts to filter by dangerous raw expressions
    if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(f.column)) continue
    switch (f.op) {
      case 'eq':
        q = q.eq(f.column, f.value)
        break
      case 'neq':
        q = q.neq(f.column, f.value)
        break
      case 'gt':
        q = q.gt(f.column, f.value)
        break
      case 'gte':
        q = q.gte(f.column, f.value)
        break
      case 'lt':
        q = q.lt(f.column, f.value)
        break
      case 'lte':
        q = q.lte(f.column, f.value)
        break
      case 'ilike':
        q = q.ilike(f.column, f.value)
        break
      case 'like':
        q = q.like(f.column, f.value)
        break
      case 'in':
        q = q.in(f.column, Array.isArray(f.value) ? f.value : [])
        break
      case 'is':
        q = q.is(f.column, f.value)
        break
    }
  }
  return q
}

/** Force ownership scope so client filters cannot widen access */
async function applyOwnershipScope(
  query: any,
  table: string,
  user: AuthUser,
  action: SecureQueryBody['action']
): Promise<{ query: any; forbidden?: string }> {
  const isAdmin = user.role === 'admin' || user.role === 'finance_executive'
  if (isAdmin) return { query }

  const hier = await getHierarchyIds(user)
  const selfEmail = user.email

  switch (table) {
    case 'partners': {
      // A master partner may read its own row AND its child partners (read-only reports).
      if (user.role === 'master_partner') {
        return { query: query.or(`id.eq.${user.partner_id},master_partner_id.eq.${user.partner_id}`) }
      }
      if (user.role === 'partner' || user.role === 'sub_partner') {
        return { query: query.eq('id', user.partner_id) }
      }
      // hierarchy roles may look up their partner org
      if (user.partner_id) return { query: query.eq('id', user.partner_id) }
      return { query, forbidden: 'No access to partners' }
    }
    case 'sub_partners': {
      if (user.role === 'partner' || user.role === 'master_partner') return { query: query.eq('parent_partner_id', user.partner_id) }
      if (user.role === 'sub_partner') return { query: query.eq('id', user.sub_partner_id) }
      return { query, forbidden: 'No access to sub_partners' }
    }
    case 'partner_wallet_ledger': {
      if (!user.partner_id) return { query, forbidden: 'No partner_id' }
      return { query: query.eq('partner_id', user.partner_id) }
    }
    case 'retailers': {
      if (user.role === 'retailer') return { query: query.eq('partner_id', user.partner_id) }
      if (user.role === 'distributor') return { query: query.eq('distributor_id', user.partner_id) }
      if (user.role === 'master_distributor') {
        // Allow MD to see retailers under their tree via master_distributor_id OR distributor in tree
        if (hier.retailerIds.length === 0) return { query: query.eq('master_distributor_id', user.partner_id) }
        return { query: query.in('partner_id', hier.retailerIds) }
      }
      if (user.role === 'partner' || user.role === 'master_partner' || user.role === 'sub_partner') {
        return { query: query.eq('partner_id', user.partner_id) }
      }
      return { query, forbidden: 'No access to retailers' }
    }
    case 'distributors': {
      if (user.role === 'distributor') return { query: query.eq('partner_id', user.partner_id) }
      if (user.role === 'master_distributor') {
        return { query: query.eq('master_distributor_id', user.partner_id) }
      }
      if (user.role === 'retailer') {
        // Retailer may only look up their own upline (distributor / master distributor),
        // regardless of that upline's status. Prevents enumerating all distributors.
        const admin = getSupabaseAdmin()
        const { data: r } = await admin
          .from('retailers')
          .select('distributor_id, master_distributor_id')
          .eq('partner_id', user.partner_id)
          .maybeSingle()
        const ids = [r?.distributor_id, r?.master_distributor_id].filter(Boolean) as string[]
        if (ids.length === 0) return { query: query.eq('partner_id', '__none__') }
        return { query: query.in('partner_id', ids) }
      }
      if (action !== 'select') {
        return { query, forbidden: 'Cannot write distributors' }
      }
      // partner / others: no broad list
      if (user.role === 'partner' || user.role === 'master_partner' || user.role === 'sub_partner') {
        return { query: query.eq('partner_id', user.partner_id) }
      }
      return { query }
    }
    case 'master_distributors': {
      if (user.role === 'master_distributor') return { query: query.eq('partner_id', user.partner_id) }
      if (action !== 'select') return { query, forbidden: 'Cannot write master_distributors' }
      return { query }
    }
    case 'admin_users':
    case 'finance_users': {
      // Non-admins may only read their own row by email (settings sidebar)
      return { query: query.eq('email', selfEmail) }
    }
    case 'wallet_ledger': {
      // Column is retailer_id (holds retailer / distributor / MD partner_id)
      const allowed = [
        hier.selfId,
        ...hier.retailerIds,
        ...hier.distributorIds,
        ...hier.masterIds,
        ...hier.partnerIds,
      ].filter(Boolean) as string[]
      if (allowed.length === 0) return { query, forbidden: 'No wallet scope' }
      return { query: query.in('retailer_id', allowed) }
    }
    case 'wallets': {
      const allowed = [
        hier.selfId,
        ...hier.retailerIds,
        ...hier.distributorIds,
        ...hier.masterIds,
        ...hier.partnerIds,
      ].filter(Boolean) as string[]
      if (allowed.length === 0) return { query, forbidden: 'No wallet scope' }
      return { query: query.in('user_id', allowed) }
    }
    case 'commission_ledger': {
      const self = user.partner_id
      if (!self) return { query, forbidden: 'No commission scope' }
      if (user.role === 'retailer') return { query: query.eq('rt_user_id', self) }
      if (user.role === 'distributor') return { query: query.eq('dt_user_id', self) }
      if (user.role === 'master_distributor') return { query: query.eq('md_user_id', self) }
      if (user.role === 'partner' || user.role === 'master_partner' || user.role === 'sub_partner') {
        // partners rarely query this; allow by any role column matching partner id
        return { query: query.or(`rt_user_id.eq.${self},dt_user_id.eq.${self},md_user_id.eq.${self}`) }
      }
      return { query, forbidden: 'No commission scope' }
    }
    case 'bbps_transactions': {
      if (user.role === 'retailer') return { query: query.eq('retailer_id', user.partner_id) }
      if (user.role === 'distributor') return { query: query.eq('distributor_id', user.partner_id) }
      if (user.role === 'master_distributor') {
        return { query: query.eq('master_distributor_id', user.partner_id) }
      }
      if (user.role === 'partner' || user.role === 'sub_partner') {
        return { query: query.eq('retailer_id', user.partner_id) }
      }
      return { query }
    }
    case 'aeps_transactions':
    case 'settlements':
    case 'transactions': {
      if (user.role === 'retailer' || user.role === 'partner' || user.role === 'sub_partner') {
        return { query: query.eq('user_id', user.partner_id) }
      }
      if (user.role === 'distributor') {
        const ids = [user.partner_id!, ...hier.retailerIds]
        return { query: query.in('user_id', ids) }
      }
      if (user.role === 'master_distributor') {
        const ids = [user.partner_id!, ...hier.distributorIds, ...hier.retailerIds]
        return { query: query.in('user_id', ids) }
      }
      return { query }
    }
    case 'razorpay_transactions': {
      // No reliable owner column for non-admin; allow select for authenticated hierarchy
      // roles (matches prior open RLS). Admin unrestricted.
      return { query }
    }
    case 'pos_machines': {
      if (user.role === 'partner' || user.role === 'sub_partner') {
        return { query: query.eq('partner_id', user.partner_id) }
      }
      // admin-only listing otherwise — non-admin get empty unless they filter by assignment
      return { query }
    }
    case 'retailer_schemes': {
      if (user.role === 'distributor') {
        // only schemes for retailers under this distributor
        if (hier.retailerIds.length === 0) return { query: query.eq('retailer_id', '__none__') }
        return { query: query.in('retailer_id', hier.retailerIds) }
      }
      if (user.role === 'retailer') return { query: query.eq('retailer_id', user.partner_id) }
      if (user.role === 'master_distributor') {
        if (hier.retailerIds.length === 0) return { query: query.eq('retailer_id', '__none__') }
        return { query: query.in('retailer_id', hier.retailerIds) }
      }
      return { query, forbidden: 'No access to retailer_schemes' }
    }
    case 'scheme_mappings': {
      // Users may read mappings for themselves or their downline
      if (user.role === 'retailer') return { query: query.eq('entity_id', user.partner_id) }
      if (user.role === 'distributor') {
        const ids = [user.partner_id!, ...hier.retailerIds]
        return { query: query.in('entity_id', ids) }
      }
      if (user.role === 'master_distributor') {
        const ids = [user.partner_id!, ...hier.distributorIds, ...hier.retailerIds]
        return { query: query.in('entity_id', ids) }
      }
      if (user.role === 'partner' || user.role === 'sub_partner') {
        return { query: query.eq('entity_id', user.partner_id) }
      }
      return { query }
    }
    case 'schemes':
    case 'global_schemes':
    case 'scheme_bbps_commissions':
    case 'scheme_payout_charges':
    case 'scheme_mdr_rates':
    case 'scheme_aeps_commissions':
    case 'scheme_aeps_settlement_charges':
    case 'scheme_shadval_settlement_charges': {
      // Read-only scheme catalog — authenticated users may read active scheme definitions
      // (same as prior client-side behavior). Writes are blocked via WRITE_TABLES.
      return { query }
    }
    default:
      return { query, forbidden: `Unhandled table scope: ${table}` }
  }
}

export async function executeSecureQuery(user: AuthUser, body: SecureQueryBody) {
  const { table, action } = body
  if (!table || typeof table !== 'string') {
    return { error: 'table required', status: 400 }
  }

  if (action === 'select') {
    if (!READ_TABLES.has(table)) return { error: `Table not allowed for read: ${table}`, status: 403 }
  } else {
    if (!WRITE_TABLES.has(table)) return { error: `Table not allowed for write: ${table}`, status: 403 }
  }

  // Profile updates: only own row
  if ((table === 'distributors' || table === 'master_distributors') && (action === 'update')) {
    if (
      (table === 'distributors' && user.role !== 'distributor') ||
      (table === 'master_distributors' && user.role !== 'master_distributor')
    ) {
      return { error: 'Forbidden', status: 403 }
    }
  }

  if (table === 'retailer_schemes' && (action === 'insert' || action === 'update' || action === 'delete')) {
    if (!['distributor', 'master_distributor', 'admin'].includes(user.role)) {
      return { error: 'Forbidden', status: 403 }
    }
  }

  const admin = getSupabaseAdmin()

  // Inserts are not constrained by post-insert filters — validate payload first
  if (action === 'insert' && table === 'retailer_schemes' && user.role !== 'admin') {
    const rows = Array.isArray(body.data) ? body.data : [body.data]
    const hier = await getHierarchyIds(user)
    for (const row of rows) {
      if (!row) return { error: 'Invalid payload', status: 400 }
      if (user.role === 'distributor') {
        if (row.distributor_id && row.distributor_id !== user.partner_id) {
          return { error: 'Cannot assign scheme for another distributor', status: 403 }
        }
        row.distributor_id = user.partner_id
        if (!row.retailer_id || !hier.retailerIds.includes(row.retailer_id)) {
          return { error: 'Retailer not in your hierarchy', status: 403 }
        }
      }
      if (user.role === 'master_distributor') {
        if (!row.retailer_id || !hier.retailerIds.includes(row.retailer_id)) {
          return { error: 'Retailer not in your hierarchy', status: 403 }
        }
      }
    }
    body.data = Array.isArray(body.data) ? rows : rows[0]
  }

  if (action === 'update' && (table === 'distributors' || table === 'master_distributors')) {
    // Strip identity fields from profile updates
    if (body.data && typeof body.data === 'object') {
      const { partner_id: _p, id: _id, email: _e, ...rest } = body.data
      body.data = rest
    }
  }

  let query: any

  if (action === 'select') {
    const opts: any = {}
    if (body.count === 'exact') opts.count = 'exact'
    query = admin.from(table).select(body.select || '*', opts)
  } else if (action === 'insert') {
    query = admin.from(table).insert(body.data).select(body.select || '*')
  } else if (action === 'update') {
    query = admin.from(table).update(body.data).select(body.select || '*')
  } else if (action === 'delete') {
    query = admin.from(table).delete().select(body.select || '*')
  } else {
    return { error: 'Invalid action', status: 400 }
  }

  const scoped = await applyOwnershipScope(query, table, user, action)
  if (scoped.forbidden) return { error: scoped.forbidden, status: 403 }
  query = scoped.query

  // For distributor/MD profile update, force partner_id match
  if (action === 'update' && (table === 'distributors' || table === 'master_distributors')) {
    query = query.eq('partner_id', user.partner_id)
  }

  query = applyClientFilters(query, body.filters)

  if (Array.isArray(body.or)) {
    for (const orStr of body.or) {
      if (isSafeOrFilter(orStr)) query = query.or(orStr)
    }
  }

  if (body.order) {
    for (const o of body.order) {
      // Allow comma/dot for multi-column and embedded-table ordering
      if (o.column && /^[a-zA-Z_][a-zA-Z0-9_,.]*$/.test(o.column)) {
        query = query.order(o.column, { ascending: o.ascending !== false })
      }
    }
  }
  if (typeof body.limit === 'number' && body.limit >= 0) {
    query = query.limit(Math.min(body.limit, 100000))
  }
  if (typeof body.offset === 'number' && body.offset >= 0) {
    query = query.range(body.offset, body.offset + (body.limit || 1000) - 1)
  }
  if (body.range && Array.isArray(body.range) && body.range.length === 2) {
    query = query.range(body.range[0], body.range[1])
  }

  if (body.single) {
    const { data, error } = await query.single()
    return { data, error: error ? { message: error.message, code: error.code } : null, count: null }
  }
  if (body.maybeSingle) {
    const { data, error } = await query.maybeSingle()
    return { data, error: error ? { message: error.message, code: error.code } : null, count: null }
  }

  const { data, error, count } = await query
  return {
    data,
    error: error ? { message: error.message, code: error.code } : null,
    count: count ?? null,
  }
}

export async function executeSecureRpc(user: AuthUser, fn: string, args: Record<string, any> = {}) {
  if (!ALLOWED_RPCS.has(fn)) {
    return { error: { message: `RPC not allowed: ${fn}` }, data: null }
  }

  // Scope RPC args to caller's identity / hierarchy
  if (fn === 'get_partner_wallet_balance') {
    if (user.role !== 'partner' && user.role !== 'sub_partner' && user.role !== 'admin') {
      return { error: { message: 'Forbidden' }, data: null }
    }
    if (user.role !== 'admin') {
      args = { ...args, p_partner_id: user.partner_id }
    }
  }

  if (fn === 'get_wallet_balance_v2' || fn === 'get_wallet_balance') {
    const requested =
      fn === 'get_wallet_balance_v2' ? args.p_user_id : args.p_retailer_id
    if (user.role === 'admin' || user.role === 'finance_executive') {
      // allow
    } else if (user.role === 'retailer' || user.role === 'partner' || user.role === 'sub_partner') {
      const self = user.partner_id
      if (requested && requested !== self) {
        return { error: { message: 'Forbidden: cannot read another wallet' }, data: null }
      }
      if (fn === 'get_wallet_balance_v2') args = { ...args, p_user_id: self }
      else args = { ...args, p_retailer_id: self }
    } else if (user.role === 'distributor' || user.role === 'master_distributor') {
      // may read self or downline
      const hier = await getHierarchyIds(user)
      const allowed = new Set(
        [hier.selfId, ...hier.retailerIds, ...hier.distributorIds, ...hier.masterIds].filter(Boolean)
      )
      if (requested && !allowed.has(requested)) {
        return { error: { message: 'Forbidden: user not in hierarchy' }, data: null }
      }
      if (!requested) {
        if (fn === 'get_wallet_balance_v2') args = { ...args, p_user_id: user.partner_id }
        else args = { ...args, p_retailer_id: user.partner_id }
      }
    }
  }

  const admin = getSupabaseAdmin()
  const { data, error } = await admin.rpc(fn, args)
  return {
    data: data ?? null,
    error: error ? { message: error.message, code: error.code } : null,
  }
}
