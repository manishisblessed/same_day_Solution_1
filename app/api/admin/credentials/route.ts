import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { apiHandler } from '@/lib/api-wrapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is missing')
  if (!supabaseServiceKey || supabaseServiceKey.trim() === '' || supabaseServiceKey === 'your_supabase_service_role_key') {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing or invalid')
  }
  return createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
}

/**
 * Verify the caller is an authenticated STRICT super_admin.
 * Returns the admin_users row on success, or a NextResponse to short-circuit.
 */
async function requireSuperAdmin(request: NextRequest, supabase: ReturnType<typeof getSupabaseClient>) {
  const { user } = await getCurrentUserWithFallback(request)
  if (!user) {
    return { error: NextResponse.json({ error: 'Session expired. Please login again.', code: 'SESSION_EXPIRED' }, { status: 401 }) }
  }
  if (user.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Admin access required' }, { status: 403 }) }
  }
  const { data: adminData } = await supabase
    .from('admin_users')
    .select('id, email, admin_type, is_active')
    .eq('email', user.email)
    .single()

  if (!adminData || adminData.is_active === false || adminData.admin_type !== 'super_admin') {
    return { error: NextResponse.json({ error: 'This section is restricted to super-admins only' }, { status: 403 }) }
  }
  return { user, adminData }
}

type RoleKey = 'retailer' | 'distributor' | 'master_distributor' | 'partner'

const ROLE_TABLES: { role: RoleKey; table: string; idField: string; hasTpin: boolean }[] = [
  { role: 'retailer', table: 'retailers', idField: 'partner_id', hasTpin: true },
  { role: 'distributor', table: 'distributors', idField: 'partner_id', hasTpin: true },
  { role: 'master_distributor', table: 'master_distributors', idField: 'partner_id', hasTpin: false },
  { role: 'partner', table: 'partners', idField: 'id', hasTpin: true },
]

/** Build a set of all auth-account emails (paginated). Used to flag whether a login exists. */
async function loadAuthEmails(supabase: ReturnType<typeof getSupabaseClient>): Promise<Set<string>> {
  const emails = new Set<string>()
  const perPage = 1000
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) break
    const users = data?.users || []
    for (const u of users) {
      if (u.email) emails.add(u.email.trim().toLowerCase())
    }
    if (users.length < perPage) break
  }
  return emails
}

async function handleGet(request: NextRequest) {
  const supabase = getSupabaseClient()

  const auth = await requireSuperAdmin(request, supabase)
  if ('error' in auth) return auth.error

  const authEmails = await loadAuthEmails(supabase)

  // Settlement accounts (retailer payout accounts) — grouped by retailer_id.
  const settlementByRetailer: Record<string, any[]> = {}
  try {
    const { data: accounts } = await supabase.from('shadval_settlement_accounts').select('*')
    for (const acc of accounts || []) {
      const key = acc.retailer_id
      if (!key) continue
      if (!settlementByRetailer[key]) settlementByRetailer[key] = []
      settlementByRetailer[key].push(acc)
    }
  } catch {
    // Table may not exist in some environments — non-fatal.
  }

  // Active scheme assignments — grouped by "<entity_id>::<entity_role>".
  const schemesByEntity: Record<string, any[]> = {}
  try {
    const { data: mappings } = await supabase
      .from('scheme_mappings')
      .select('id, scheme_id, entity_id, entity_role, service_type, priority, schemes(name, scheme_type, service_scope, status, is_partner_plan)')
      .eq('status', 'active')
      .order('priority', { ascending: true })
    for (const m of (mappings as any[]) || []) {
      const key = `${m.entity_id}::${m.entity_role}`
      if (!schemesByEntity[key]) schemesByEntity[key] = []
      const s = Array.isArray(m.schemes) ? m.schemes[0] : m.schemes
      schemesByEntity[key].push({
        mapping_id: m.id,
        scheme_id: m.scheme_id,
        service_type: m.service_type || 'all',
        name: s?.name || 'Unknown scheme',
        scheme_type: s?.scheme_type || null,
        service_scope: s?.service_scope || null,
        is_partner_plan: !!s?.is_partner_plan,
        status: s?.status || null,
      })
    }
  } catch {
    // scheme_mappings may not exist in some environments — non-fatal.
  }

  const users: any[] = []

  for (const cfg of ROLE_TABLES) {
    const { data, error } = await supabase
      .from(cfg.table)
      .select('*')
      .order('created_at', { ascending: false })

    if (error || !data) continue

    for (const row of data) {
      const identifier = row[cfg.idField]
      const email = (row.email || '').trim().toLowerCase()
      const now = Date.now()
      const lockedUntil = row.tpin_locked_until ? new Date(row.tpin_locked_until).getTime() : 0

      users.push({
        role: cfg.role,
        id: row.id,
        identifier,
        name: row.name || '',
        email: row.email || '',
        phone: row.phone || '',
        status: row.status || '',
        verification_status: row.verification_status || null,
        has_login: email ? authEmails.has(email) : false,
        tpin: cfg.hasTpin
          ? {
              supported: true,
              enabled: !!row.tpin_enabled,
              locked: lockedUntil > now,
              locked_until: row.tpin_locked_until || null,
              failed_attempts: row.tpin_failed_attempts || 0,
            }
          : { supported: false, enabled: false, locked: false, locked_until: null, failed_attempts: 0 },
        settlement_accounts: cfg.role === 'retailer' ? settlementByRetailer[identifier] || [] : [],
        schemes: schemesByEntity[`${identifier}::${cfg.role}`] || [],
        created_at: row.created_at,
        // Full raw record for the detail view. tpin_hash is intentionally excluded below.
        details: sanitize(row),
      })
    }
  }

  return NextResponse.json({ success: true, count: users.length, users })
}

/** Strip only the raw hash (never displayable). Everything else is returned. */
function sanitize(row: Record<string, any>) {
  const { tpin_hash, ...rest } = row
  return { ...rest, tpin_hash_present: !!tpin_hash }
}

export const GET = apiHandler(handleGet)
