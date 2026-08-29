/**
 * Backfill: give every existing finance executive a department-scoped sub-admin
 * row in admin_users so they can use the admin portal (see the finance parity
 * change). Idempotent — safe to run multiple times.
 *
 * Usage: node scripts/backfill-finance-admin-rows.js
 */
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Grantable section ids (mirror lib/auth-roles.ts FINANCE_TABS). Excludes settings/all.
const FINANCE_TAB_IDS = [
  'dashboard', 'onboarding', 'daily-report', 'business-analytics', 'pos-transactions',
  'pos-reconciliation', 'retailers', 'distributors', 'master-distributors', 'scheme-management',
  'partners', 'pos-machines', 'pos-history', 'pos-tracking-report', 'pos-rental-report',
  'pos-partner-api', 'master-partners', 'services', 'aeps', 'reports', 'service-transaction-report',
  'pos-report', 'bill-payment-report', 'aeps-report', 'settlement-report', 'settlement',
  'settlement-2-approvals', 'revenue-wallet', 'wallet-ledger', 'push-pull-report', 'performance',
  'subscriptions', 'portal-management', 'legal-agreements', 'reversals',
]

// Safe legacy single-department values (never 'all'/'settings'/'users').
const SAFE_LEGACY_DEPTS = ['wallet', 'commission', 'mdr', 'limits', 'services', 'reversals', 'disputes', 'reports']
const legacyDepartmentFor = (departments) =>
  departments.find((d) => SAFE_LEGACY_DEPTS.includes(d)) || 'reports'

const sanitizeTabs = (tabs) => {
  if (!Array.isArray(tabs)) return []
  if (tabs.includes('all')) return [...FINANCE_TAB_IDS]
  return FINANCE_TAB_IDS.filter((id) => tabs.includes(id))
}

async function resolveAuthUserId(email) {
  const lower = email.toLowerCase()
  for (let page = 1; page <= 50; page++) {
    const { data } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    const users = (data && data.users) || []
    const match = users.find((u) => (u.email || '').toLowerCase() === lower)
    if (match) return match.id
    if (users.length < 1000) break
  }
  return null
}

async function run() {
  const { data: financeUsers, error } = await supabase
    .from('finance_users')
    .select('id, email, name, tabs, is_active')

  if (error) {
    console.error('Failed to load finance_users:', error.message)
    process.exit(1)
  }

  console.log(`Found ${financeUsers.length} finance user(s). Backfilling admin_users rows...\n`)

  let created = 0, updated = 0, skipped = 0, failed = 0

  for (const fu of financeUsers) {
    const departments = sanitizeTabs(fu.tabs)
    const department = legacyDepartmentFor(departments)

    const { data: existing } = await supabase
      .from('admin_users')
      .select('id, admin_type')
      .eq('email', fu.email)
      .maybeSingle()

    if (existing) {
      // Don't downgrade a real super_admin that happens to share this email.
      if (existing.admin_type === 'super_admin') {
        console.log(`  = ${fu.email} (already super_admin, left untouched)`)
        skipped++
        continue
      }
      const { error: upErr } = await supabase
        .from('admin_users')
        .update({ admin_type: 'sub_admin', name: fu.name, departments, department, is_active: fu.is_active !== false })
        .eq('id', existing.id)
      if (upErr) { console.error(`  x ${fu.email} update failed: ${upErr.message}`); failed++ }
      else { console.log(`  ~ ${fu.email} (updated -> [${departments.join(', ') || 'none'}])`); updated++ }
      continue
    }

    const authId = await resolveAuthUserId(fu.email)
    if (!authId) { console.error(`  x ${fu.email} — no auth user found, skipped`); failed++; continue }

    const { error: insErr } = await supabase.from('admin_users').insert({
      id: authId,
      email: fu.email,
      name: fu.name || fu.email,
      admin_type: 'sub_admin',
      department,
      departments,
      permissions: {},
      is_active: fu.is_active !== false,
    })
    if (insErr) { console.error(`  x ${fu.email} insert failed: ${insErr.message}`); failed++ }
    else { console.log(`  + ${fu.email} (created -> [${departments.join(', ') || 'none'}])`); created++ }
  }

  console.log(`\nDone. created=${created} updated=${updated} skipped=${skipped} failed=${failed}`)
}

run().catch((e) => { console.error(e); process.exit(1) })
