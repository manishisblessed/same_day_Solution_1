/**
 * Fix ledger DISPLAY ordering for the 16-Sept Shah Works reconciliation.
 *
 * The reconciliation wrote all 6 ledger rows inside ONE db transaction, so
 * Postgres now() gave them an identical created_at. The running-balance column
 * (closing_balance) is CORRECT, but the UI (order by created_at desc) shows the
 * rows out of sequence. This re-stamps created_at so rows display in the order
 * their balance actually progressed (reversal → AMEX → VISAs), ending at the
 * true balance. Balances/credits are NOT touched.
 *
 * DRY-RUN by default. Pass --commit to apply.
 */
const { Client } = require('pg')
const fs = require('fs'), path = require('path')
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const COMMIT = process.argv.includes('--commit')
const P = '078ebf34-5593-47c2-98ff-101e4e275c39'
const REFS = [
  'REVERSAL-PARTNER-T1-2026-09-17-078ebf34-5593-47c2-98ff-101e4e275c39-35dc17018057',
  'PARTNER-T1-2026-09-17-078ebf34-5593-47c2-98ff-101e4e275c39-c2db3ac194df',
  'PARTNER-T1-2026-09-17-078ebf34-5593-47c2-98ff-101e4e275c39-2ccd609c0429',
  'PARTNER-T1-2026-09-17-078ebf34-5593-47c2-98ff-101e4e275c39-f62a40555486',
  'PARTNER-T1-2026-09-17-078ebf34-5593-47c2-98ff-101e4e275c39-1e6afbd19b38',
  'PARTNER-T1-2026-09-17-078ebf34-5593-47c2-98ff-101e4e275c39-15d8a52a879c',
]
;(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const q = (s, p) => c.query(s, p).then(r => r.rows)

  // Order rows by their stored closing_balance (== insertion order == correct chronology).
  const rows = await q(
    `select id, reference_id, credit, debit, opening_balance, closing_balance, created_at
       from partner_wallet_ledger where partner_id=$1 and reference_id = any($2)
      order by closing_balance asc`, [P, REFS])

  console.log(`\n=== ${COMMIT ? 'COMMIT' : 'DRY-RUN'} — re-stamp created_at in balance order ===\n`)
  const base = new Date(Math.min(...rows.map(r => new Date(r.created_at).getTime())))
  const plan = rows.map((r, i) => ({ ...r, newTs: new Date(base.getTime() + i * 1000) }))
  for (const r of plan) {
    console.log(`  bal ${String(r.closing_balance).padStart(12)}  ${r.credit > 0 ? 'CR ' + r.credit : 'DR ' + r.debit}  ${r.created_at.toISOString?.() || r.created_at} → ${r.newTs.toISOString()}  (${r.reference_id.slice(-12)})`)
  }

  if (!COMMIT) { console.log('\nDRY-RUN. Re-run with --commit.'); await c.end(); return }
  await c.query('BEGIN')
  try {
    for (const r of plan) {
      await c.query(`update partner_wallet_ledger set created_at=$1 where id=$2`, [r.newTs.toISOString(), r.id])
    }
    await c.query('COMMIT')
  } catch (e) { await c.query('ROLLBACK'); throw e }
  console.log('\nCOMMIT successful — ledger now displays in correct running-balance order.')
  await c.end()
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
