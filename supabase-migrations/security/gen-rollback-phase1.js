// Snapshots the CURRENT public-schema grants for `anon` and EXECUTE grants on the
// dangerous SECURITY DEFINER functions, then writes a runnable phase1-rollback.sql
// that restores exactly that state. Run from repo root BEFORE applying phase 1.
//   node supabase-migrations/security/gen-rollback-phase1.js
const fs = require('fs')
const path = require('path')
const { getClient } = require('./_db')

const DANGER_FUNCS = [
  'assign_pos_device', 'backfill_pos_retailer_ids', 'calculate_aeps_commission_from_scheme',
  'calculate_shadval_settlement_charge_from_scheme', 'check_admin_permission', 'check_rate_limit',
  'cleanup_expired_sessions', 'credit_partner_wallet', 'debit_partner_wallet', 'ensure_partner_wallet',
  'get_aeps_stats', 'get_partner_scheme', 'get_paused_partner_ids', 'get_pos_stats',
  'get_pos_tracking_summary', 'log_activity', 'refresh_business_analytics', 'refund_partner_wallet',
  'return_pos_device', 'set_distributor_tpin', 'set_partner_tpin', 'set_partner_wallet_frozen',
  'set_retailer_tpin', 'settle_pos_txn_t1', 'verify_distributor_tpin', 'verify_partner_tpin',
  'verify_retailer_tpin',
]

async function main() {
  const client = await getClient()
  try {
    const tblGrants = await client.query(`
      SELECT count(DISTINCT table_name) AS n_tables, count(*) AS n_grants
      FROM information_schema.role_table_grants
      WHERE table_schema='public' AND grantee='anon'`)

    const sigs = await client.query(`
      SELECT p.oid::regprocedure::text AS sig,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname = ANY($1)
      ORDER BY 1`, [DANGER_FUNCS])

    const lines = []
    lines.push('-- ROLLBACK for phase1-revoke-anon-and-danger-funcs.sql')
    lines.push('-- Auto-generated snapshot of prior state. Run to restore.')
    lines.push(`-- Snapshot: anon had grants on ${tblGrants.rows[0].n_tables} tables (${tblGrants.rows[0].n_grants} privilege rows).`)
    lines.push(`-- Snapshot captured: ${new Date().toISOString()}`)
    lines.push('')
    lines.push('-- Restore anon default privileges + blanket grants (prior state = anon had ALL).')
    lines.push('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;')
    lines.push('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;')
    lines.push('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon;')
    lines.push('GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;')
    lines.push('GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;')
    lines.push('GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon;')
    lines.push('')
    lines.push('-- Restore EXECUTE on the dangerous functions to the roles that previously held it.')
    for (const row of sigs.rows) {
      const roles = []
      if (row.anon_exec) roles.push('anon')
      if (row.auth_exec) roles.push('authenticated')
      if (roles.length) {
        lines.push(`GRANT EXECUTE ON FUNCTION ${row.sig} TO ${roles.join(', ')};`)
      }
    }
    lines.push('')

    const outPath = path.join(__dirname, 'phase1-rollback.sql')
    fs.writeFileSync(outPath, lines.join('\n'), 'utf8')
    console.log('Wrote', outPath)
    console.log(`Captured ${sigs.rows.length} function signatures.`)
  } finally {
    await client.end()
  }
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1) })
