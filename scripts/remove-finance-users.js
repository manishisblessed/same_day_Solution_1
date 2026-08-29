/**
 * Remove ALL existing finance executives: deletes their finance_users row, the
 * backing admin_users sub-admin row (if any), and their Supabase Auth login.
 *
 * Destructive + irreversible. Run against the DB in .env.local.
 * Usage: node scripts/remove-finance-users.js
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

async function resolveAuthUserId(email, fallbackId) {
  // Prefer a direct id hit, else scan auth users by email.
  if (fallbackId) {
    try {
      const { data } = await supabase.auth.admin.getUserById(fallbackId)
      if (data?.user) return fallbackId
    } catch {}
  }
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
    .select('id, email, name')

  if (error) {
    console.error('Failed to load finance_users:', error.message)
    process.exit(1)
  }

  if (!financeUsers.length) {
    console.log('No finance users found. Nothing to remove.')
    return
  }

  console.log(`Removing ${financeUsers.length} finance user(s)...\n`)
  let removed = 0, failed = 0

  for (const fu of financeUsers) {
    const email = fu.email
    try {
      // 1) Remove the backing admin_users sub-admin row (never a super_admin).
      const { data: adminRow } = await supabase
        .from('admin_users')
        .select('id, admin_type')
        .eq('email', email)
        .maybeSingle()

      if (adminRow && adminRow.admin_type !== 'super_admin') {
        // Clear self-referencing created_by pointers, then try hard delete.
        await supabase.from('admin_users').update({ created_by: null }).eq('created_by', adminRow.id)
        const { error: delAdminErr } = await supabase.from('admin_users').delete().eq('id', adminRow.id)
        if (delAdminErr) {
          // Likely blocked by immutable admin_audit_log FK — deactivate instead.
          await supabase.from('admin_users').update({ is_active: false }).eq('id', adminRow.id)
          console.log(`  ! ${email}: admin_users kept (deactivated) — ${delAdminErr.message}`)
        }
      }

      // 2) Delete the finance_users row.
      const { error: delFinErr } = await supabase.from('finance_users').delete().eq('id', fu.id)
      if (delFinErr) throw new Error(`finance_users delete failed: ${delFinErr.message}`)

      // 3) Remove the Supabase Auth login (skip if a super_admin shares the email).
      const skipAuth = adminRow && adminRow.admin_type === 'super_admin'
      if (!skipAuth) {
        const authId = await resolveAuthUserId(email, adminRow?.id)
        if (authId) await supabase.auth.admin.deleteUser(authId)
      }

      console.log(`  - removed ${email}`)
      removed++
    } catch (e) {
      console.error(`  x ${email}: ${e.message}`)
      failed++
    }
  }

  console.log(`\nDone. removed=${removed} failed=${failed}`)
}

run().catch((e) => { console.error(e); process.exit(1) })
