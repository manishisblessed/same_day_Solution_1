/**
 * Normalize the "Diners Club" scheme brand label to the canonical "DINERS" so it
 * matches the normalized transaction brand at settlement time (root cause of the
 * unsettled DINERS card txn). Safe canonicalization: the settlement matcher
 * normalizes the txn brand to "DINERS", so storing "DINERS" only enables matches
 * that should already happen. Affects all schemes carrying the bad label.
 *
 * DRY-RUN by default. Pass --commit to apply.
 */
const { Client } = require('pg')
const fs = require('fs'), path = require('path')
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const COMMIT = process.argv.includes('--commit')
;(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const rows = (await c.query(
    `select id, scheme_id, brand_type from scheme_mdr_rates where brand_type ilike 'diners%' and brand_type <> 'DINERS'`
  )).rows
  console.log(`\n=== ${COMMIT ? 'COMMIT' : 'DRY-RUN'} — normalize brand_type → 'DINERS' ===`)
  console.log(`Rows to update: ${rows.length}`)
  const bySchemes = [...new Set(rows.map(r => r.scheme_id))]
  console.log(`Across ${bySchemes.length} scheme(s).`)
  if (!COMMIT) { console.log('\nDRY-RUN. Re-run with --commit.'); await c.end(); return }
  const res = await c.query(`update scheme_mdr_rates set brand_type='DINERS' where brand_type ilike 'diners%' and brand_type <> 'DINERS'`)
  console.log(`Updated ${res.rowCount} row(s).`)
  await c.end()
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
