/**
 * Hard-delete a partner account and all associated records so the email/phone
 * can be reused for a fresh onboarding.
 *
 * Usage:
 *   npx tsx scripts/delete-partner-account.ts --email=umeshj9787@gmail.com --phone=9004080939
 *
 * Add --dry-run to preview without making any changes.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

function arg(name: string) {
  const flag = `--${name}=`
  return process.argv.find(a => a.startsWith(flag))?.slice(flag.length)
}

const EMAIL   = arg('email')?.toLowerCase().trim()
const PHONE   = arg('phone')?.trim()
const DRY_RUN = process.argv.includes('--dry-run')

if (!EMAIL && !PHONE) {
  console.error('❌  Provide at least --email or --phone')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ─── helpers ──────────────────────────────────────────────────────────────────

function orFilter(email?: string, phone?: string) {
  const parts: string[] = []
  if (email) parts.push(`email.eq.${email}`)
  if (phone) parts.push(`phone.eq.${phone}`)
  return parts.join(',')
}

async function deleteRows(table: string, column: string, value: string | string[], label: string) {
  if (!value || (Array.isArray(value) && value.length === 0)) return
  if (DRY_RUN) { console.log(`  [dry-run] would delete from ${table} where ${column} in [${value}]`); return }
  const q = Array.isArray(value)
    ? supabase.from(table).delete().in(column, value)
    : supabase.from(table).delete().eq(column, value)
  const { error, count } = await q
  if (error) console.warn(`  ⚠️  ${table}: ${error.message}`)
  else       console.log(`  ✅ Deleted ${label}`)
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔍  Searching for account  email=${EMAIL ?? '–'}  phone=${PHONE ?? '–'}\n`)
  if (DRY_RUN) console.log('⚠️  DRY RUN — no changes will be made\n')

  // 1. Find partner records across all role tables
  const ROLE_TABLES = ['partners', 'retailers', 'distributors', 'master_distributors'] as const
  const found: { table: string; id: string; email: string; phone: string }[] = []

  for (const table of ROLE_TABLES) {
    const filter = orFilter(EMAIL, PHONE)
    const { data, error } = await supabase.from(table).select('id,email,phone').or(filter)
    if (error) { console.warn(`  ⚠️  ${table} query: ${error.message}`); continue }
    if (data?.length) {
      data.forEach(r => found.push({ table, id: r.id, email: r.email, phone: r.phone }))
      data.forEach(r => console.log(`  Found in ${table}: id=${r.id}  email=${r.email}  phone=${r.phone}`))
    }
  }

  // 2. Find in onboarding_invites
  const inviteFilter = orFilter(EMAIL, PHONE)
  const { data: invites } = await supabase
    .from('onboarding_invites')
    .select('id,email,phone,status')
    .or(inviteFilter)
  const inviteIds = (invites || []).map(i => i.id)
  if (invites?.length) {
    invites.forEach(i => console.log(`  Found in onboarding_invites: id=${i.id}  status=${i.status}`))
  }

  // 3. Find Supabase auth user
  let authUserId: string | null = null
  if (EMAIL) {
    const { data: { users }, error } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    if (!error) {
      const match = users.find(u => u.email?.toLowerCase() === EMAIL)
      if (match) {
        authUserId = match.id
        console.log(`  Found auth user: id=${match.id}  email=${match.email}`)
      }
    }
  }

  if (!found.length && !inviteIds.length && !authUserId) {
    console.log('\n✅  No records found — nothing to delete.')
    return
  }

  console.log('\n🗑️  Deleting records...\n')

  // ── Per-partner cleanup ──────────────────────────────────────────────────
  for (const rec of found) {
    if (rec.table === 'partners') {
      const pid = rec.id
      // Cascade: sub_partners, partner_wallets, partner_wallet_ledger, partner_schemes
      await deleteRows('sub_partners', 'parent_partner_id', pid, `sub_partners for partner ${pid}`)
      await deleteRows('partner_wallet_ledger', 'partner_id', pid, `wallet ledger for partner ${pid}`)
      await deleteRows('partner_wallets', 'partner_id', pid, `partner_wallets for partner ${pid}`)
      await deleteRows('partner_schemes', 'partner_id', pid, `partner_schemes for partner ${pid}`)
    }
    // Delete the role row itself
    await deleteRows(rec.table, 'id', rec.id, `${rec.table} record id=${rec.id}`)
  }

  // ── Onboarding cleanup ───────────────────────────────────────────────────
  if (inviteIds.length) {
    await deleteRows('onboarding_verifications', 'invite_id', inviteIds, `onboarding_verifications (${inviteIds.length})`)
    await deleteRows('onboarding_otps', 'invite_id', inviteIds, `onboarding_otps (${inviteIds.length})`)
    await deleteRows('onboarding_invites', 'id', inviteIds, `onboarding_invites (${inviteIds.length})`)
  }

  // ── Supabase auth user ───────────────────────────────────────────────────
  if (authUserId) {
    if (DRY_RUN) {
      console.log(`  [dry-run] would delete auth user ${authUserId}`)
    } else {
      const { error } = await supabase.auth.admin.deleteUser(authUserId)
      if (error) console.warn(`  ⚠️  auth.deleteUser: ${error.message}`)
      else       console.log(`  ✅ Deleted Supabase auth user ${authUserId}`)
    }
  }

  console.log('\n✅  Done. The email/phone is now free for a fresh partner registration.\n')
}

main().catch(err => { console.error(err); process.exit(1) })
