/* eslint-disable */
// One-off: backfill CA reimbursements for the current month (IST) across both
// POS tables, then print the live per-company summary so we can verify the
// dashboard will render correctly. Safe to re-run (backfill skips existing rows).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.join(__dirname, '..')

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    const key = m[1]
    if (process.env[key] !== undefined && process.env[key] !== '') continue
    let value = m[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}
for (const f of [path.join(ROOT, '.env.local'), path.join(process.cwd(), '.env.local')]) loadEnvFile(f)

function sslFor(s) {
  s = s || ''
  if (/sslmode=disable/i.test(s)) return false
  if (/@localhost|@127\.0\.0\.1|@\[::1\]/i.test(s)) return false
  return { rejectUnauthorized: false }
}

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) { console.error('DATABASE_URL missing in .env.local'); process.exit(1) }

const client = new Client({ connectionString: DATABASE_URL, ssl: sslFor(DATABASE_URL) })

const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function main() {
  await client.connect()

  // Return as TEXT to avoid the pg driver's local-midnight Date → UTC shift.
  const { rows: [b] } = await client.query(
    `SELECT to_char(date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')), 'YYYY-MM-DD') AS month_start,
            to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS today`
  )
  const from = b.month_start
  const to = b.today
  console.log(`\nBackfilling CA reimbursements ${from} → ${to} (IST current month)\n`)

  const rz = await client.query('SELECT * FROM ca_backfill_reimbursements_razorpay($1,$2,NULL)', [from, to])
  console.log(`  razorpay_pos_transactions : processed ${rz.rows[0].processed}, skipped ${rz.rows[0].skipped}`)

  let posProcessed = 0
  try {
    const pos = await client.query('SELECT * FROM ca_backfill_reimbursements($1,$2,NULL)', [from, to])
    posProcessed = pos.rows[0].processed
    console.log(`  pos_transactions          : processed ${pos.rows[0].processed}, skipped ${pos.rows[0].skipped}`)
  } catch (e) {
    console.log(`  pos_transactions          : (skipped — ${e.message})`)
  }

  console.log('\nLive per-company summary (ca_company_live_summary):\n')
  const sum = await client.query('SELECT * FROM ca_company_live_summary()')
  const header = ['COMPANY', 'TODAY', 'MTD TXNS', 'MTD VALUE', 'MTD BANK MDR', 'PROJ GST'].join('  |  ')
  console.log('  ' + header)
  console.log('  ' + '-'.repeat(header.length))
  let tToday = 0, tMonth = 0
  for (const r of sum.rows) {
    tToday += Number(r.today_count); tMonth += Number(r.month_count)
    console.log('  ' + [
      (r.brand_name || r.brand_short).padEnd(18),
      String(r.today_count).padStart(5),
      String(r.month_count).padStart(8),
      money(r.month_txn_value).padStart(16),
      money(r.month_bank_mdr).padStart(14),
      money(r.month_gst).padStart(12),
    ].join('  |  '))
  }
  console.log('  ' + '-'.repeat(header.length))
  console.log(`  TOTAL today=${tToday}  month=${tMonth}\n`)

  await client.end()
}

main().catch(async (e) => { console.error(e); try { await client.end() } catch {} ; process.exit(1) })
