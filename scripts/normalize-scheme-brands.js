/**
 * Canonicalize scheme_mdr_rates.brand_type (and partner_schemes.brand_type) to
 * the values the settlement engine and the scheme dropdowns now use. Only rows
 * whose brand normalizes to a REAL card network are touched; classification-like
 * pseudo-brands (Business/Corporate Card/International) are left alone and
 * reported so they can be reviewed/removed separately.
 *
 * DRY-RUN by default. Pass --commit to apply.
 */
const { Client } = require('pg')
const fs = require('fs'), path = require('path')
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const COMMIT = process.argv.includes('--commit')
const REAL = new Set(['VISA','MASTERCARD','RUPAY','AMEX','DINERS','MAESTRO','JCB','DISCOVER'])
function normalizeBrandType(brand) {
  if (!brand) return null
  const n = brand.toUpperCase().replace(/[\s_-]+/g, '')
  const A = { MASTERCARD:'MASTERCARD', MASTER:'MASTERCARD', MC:'MASTERCARD', VISA:'VISA', AMEX:'AMEX', AMERICANEXPRESS:'AMEX', RUPAY:'RUPAY', DINERS:'DINERS', DINERSCLUB:'DINERS', MAESTRO:'MAESTRO', JCB:'JCB', DISCOVER:'DISCOVER' }
  return A[n] || n || null
}
;(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  console.log(`\n=== ${COMMIT ? 'COMMIT' : 'DRY-RUN'} — canonicalize brand_type ===\n`)
  let updated = 0
  const pseudo = new Set()
  for (const tbl of ['scheme_mdr_rates', 'partner_schemes']) {
    const rows = (await c.query(`select id, brand_type from ${tbl} where brand_type is not null`)).rows
    for (const r of rows) {
      const norm = normalizeBrandType(r.brand_type)
      if (!REAL.has(norm)) { pseudo.add(`${tbl}: ${r.brand_type}`); continue }
      if (norm !== r.brand_type) {
        console.log(`  ${tbl}  [${r.brand_type}] → [${norm}]`)
        if (COMMIT) await c.query(`update ${tbl} set brand_type=$1 where id=$2`, [norm, r.id])
        updated++
      }
    }
  }
  console.log(`\n${COMMIT ? 'Updated' : 'Would update'} ${updated} row(s).`)
  if (pseudo.size) console.log('Non-brand labels left untouched (review as classifications):', [...pseudo].join(', '))
  if (!COMMIT) console.log('\nDRY-RUN. Re-run with --commit.')
  await c.end()
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
