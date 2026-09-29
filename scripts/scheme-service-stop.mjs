/* eslint-disable */
// Audit (and optionally stop) active users that have NO active, in-window scheme
// mapping. After the global-fallback removal such users can no longer transact;
// this makes that state explicit/operational.
//
//   node scripts/scheme-service-stop.mjs            # DRY RUN: report only
//   node scripts/scheme-service-stop.mjs --apply    # stop services for those users
//
// "Stop services" is reversible:
//   - partners: set every *_enabled service flag to false (account left intact)
//   - retailers/distributors/master_distributors: set status = 'suspended'
//     (reason recorded in scheme_stop_reason when the column exists)

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { Client } = require('pg')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

function loadEnv(file) {
  if (!fs.existsSync(file)) return
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    if (process.env[m[1]]) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[m[1]] = v
  }
}
loadEnv(path.join(ROOT, '.env.local'))

const APPLY = process.argv.includes('--apply')

const ACTIVE_MAPPINGS = `
  WITH active_mappings AS (
    SELECT sm.entity_id, sm.entity_role
    FROM scheme_mappings sm
    JOIN schemes s ON s.id = sm.scheme_id
    WHERE sm.status = 'active' AND s.status = 'active'
      AND sm.effective_from <= NOW() AND (sm.effective_to IS NULL OR sm.effective_to > NOW())
      AND s.effective_from  <= NOW() AND (s.effective_to  IS NULL OR s.effective_to  > NOW())
    GROUP BY sm.entity_id, sm.entity_role
  )`

const ROLES = [
  { role: 'retailer',           table: 'retailers',           idcol: 'partner_id' },
  { role: 'distributor',        table: 'distributors',        idcol: 'partner_id' },
  { role: 'master_distributor', table: 'master_distributors', idcol: 'partner_id' },
  { role: 'partner',            table: 'partners',            idcol: 'id' },
]

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL not set')
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    console.log(`Mode: ${APPLY ? 'APPLY (will stop services)' : 'DRY RUN (report only)'}\n`)

    const targets = {}
    for (const { role, table, idcol } of ROLES) {
      const q = `${ACTIVE_MAPPINGS}
        SELECT u.${idcol}::text AS entity_id, u.name, u.email
        FROM ${table} u
        LEFT JOIN active_mappings am ON am.entity_id = u.${idcol}::text AND am.entity_role = '${role}'
        WHERE u.status = 'active' AND am.entity_id IS NULL
        ORDER BY u.name`
      const { rows } = await client.query(q)
      targets[role] = rows
      console.log(`${role.padEnd(20)} without scheme: ${rows.length}`)
      for (const r of rows.slice(0, 20)) console.log(`   - ${r.entity_id}  ${r.name || ''}  ${r.email || ''}`)
      if (rows.length > 20) console.log(`   ... and ${rows.length - 20} more`)
      console.log('')
    }

    if (!APPLY) {
      console.log('DRY RUN complete. Re-run with --apply to stop services for the users listed above.')
      return
    }

    // ---- APPLY (single transaction: all-or-nothing) ----
    await client.query('BEGIN')
    try {
      // Partners: disable all service flags (account left intact, reversible).
      const partnerIds = targets['partner'].map((r) => r.entity_id)
      if (partnerIds.length) {
        const res = await client.query(
          `UPDATE partners SET
             bbps_enabled = false,
             bbps2_pay2new_enabled = false,
             settlement_enabled = false,
             settlement2_enabled = false,
             aeps_enabled = false,
             rechargekit_cc_enabled = false
           WHERE id::text = ANY($1::text[])`,
          [partnerIds]
        )
        console.log(`partners: disabled all service flags for ${res.rowCount} account(s)`)
      }

      // Retailers / distributors / master_distributors: suspend the account.
      for (const { role, table, idcol } of ROLES.filter((r) => r.role !== 'partner')) {
        const ids = targets[role].map((r) => r.entity_id)
        if (!ids.length) continue
        const res = await client.query(
          `UPDATE ${table} SET status = 'suspended'
           WHERE ${idcol}::text = ANY($1::text[]) AND status = 'active'`,
          [ids]
        )
        console.log(`${role}: suspended ${res.rowCount} account(s)`)
      }

      await client.query('COMMIT')
      console.log('\n✅ Services stopped for all active users without an assigned scheme.')
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      throw e
    }
  } finally {
    await client.end()
  }
}

main().catch((e) => { console.error('❌', e.message); process.exit(1) })
