/**
 * READ-ONLY: verify every FAILED+refunded Settlement-2 (Shadval) transaction
 * against the PROVIDER's live status API, to find refunds that were issued even
 * though the bank payout actually SUCCEEDED (double-money losses).
 *
 * MUST be run from a Shadval-whitelisted host (e.g. the production EC2), because
 * the check_status API rejects non-whitelisted IPs (SP102).
 *
 * Makes NO database or wallet changes. It only reads and reports.
 *
 * Env (auto-loaded from ./.env.local if present, else process.env):
 *   DATABASE_URL, SHADVAL_PAY_KEY (or SHADVAL_PAY_AUTHORIZATION_KEY),
 *   SHADVAL_PAY_BASE_URL, SHADVAL_PAY_ENV
 *
 * Usage:
 *   node scripts/verify-shadval-refunds-vs-provider.js            # all refunded-FAILED
 *   node scripts/verify-shadval-refunds-vs-provider.js --days 30
 *   node scripts/verify-shadval-refunds-vs-provider.js --initiated-only
 */
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

// --- tiny .env.local loader (no dotenv dependency) ---
;(function loadEnv() {
  const p = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(p)) return
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const k = m[1]
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[k] === undefined) process.env[k] = v
  }
})()

const DB_URL = process.env.DATABASE_URL
const KEY = process.env.SHADVAL_PAY_KEY || process.env.SHADVAL_PAY_AUTHORIZATION_KEY
const BASE = process.env.SHADVAL_PAY_BASE_URL || 'https://partners.shadvalpay.co.in/api'
const IS_UAT = process.env.SHADVAL_PAY_ENV !== 'production'
const STATUS_URL = `${BASE}/${IS_UAT ? 'uat_payout_i/check_status' : 'payout_i/check_status'}`

if (!DB_URL) { console.error('DATABASE_URL required'); process.exit(1) }
if (!KEY) { console.error('SHADVAL_PAY_KEY required'); process.exit(1) }

const argv = process.argv.slice(2)
const daysIdx = argv.indexOf('--days')
const DAYS = daysIdx > -1 ? parseInt(argv[daysIdx + 1], 10) || 3650 : 3650
const INITIATED_ONLY = argv.includes('--initiated-only')
const CONCURRENCY = 10

function isGenuineProviderSuccess(d) {
  if (!d || d.status !== 'SUCCESS' || !d.data) return false
  const s = (d.data.txn_status || '').toLowerCase()
  const hasUtr = !!(d.data.utr && String(d.data.utr).trim())
  return hasUtr && s.includes('success') && !s.includes('refund') && !s.includes('revers') &&
    !s.includes('fail') && !s.includes('initiat') && !s.includes('pending') && !s.includes('process')
}

async function providerStatus(reference_id) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch(STATUS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': KEY },
      body: JSON.stringify({ reference_id }),
      signal: ctrl.signal,
    })
    return await res.json()
  } catch (e) {
    return { status: 'FAILED', code: 'LOCAL_ERROR', message: e.message }
  } finally {
    clearTimeout(t)
  }
}

async function main() {
  const c = new Client({ connectionString: DB_URL })
  await c.connect()

  let sql = `
    SELECT f.reference_id, f.retailer_id, f.utr, f.order_id, f.status_message, f.created_at,
           COALESCE(rl.credit, pl.credit) AS refund_credit,
           CASE WHEN rl.id IS NOT NULL THEN 'retailer' ELSE 'partner' END AS wallet
    FROM shadval_settlement f
    LEFT JOIN LATERAL (SELECT id, credit FROM wallet_ledger WHERE retailer_id=f.retailer_id
        AND reference_id IN ('REFUND_'||f.reference_id,'REFUND_TIMEOUT_'||f.reference_id) AND credit>0 LIMIT 1) rl ON TRUE
    LEFT JOIN LATERAL (SELECT id, credit FROM partner_wallet_ledger WHERE partner_id::text=f.retailer_id
        AND reference_id IN ('REFUND_'||f.reference_id,'REFUND_TIMEOUT_'||f.reference_id) AND credit>0 LIMIT 1) pl ON TRUE
    WHERE f.status='FAILED'
      AND (rl.id IS NOT NULL OR pl.id IS NOT NULL)
      AND f.created_at >= NOW() - ($1 || ' days')::interval
  `
  if (INITIATED_ONLY) sql += ` AND lower(f.status_message) LIKE '%initiat%'`
  sql += ` ORDER BY f.created_at DESC`

  const { rows } = await c.query(sql, [String(DAYS)])
  console.log(`Candidates (FAILED + refunded${INITIATED_ONLY ? ', "initiated" msg only' : ''}, last ${DAYS} days): ${rows.length}`)
  console.log(`Querying provider ${STATUS_URL} with concurrency ${CONCURRENCY}...\n`)

  const confirmed = []   // provider says genuine SUCCESS but we refunded
  const stillFailed = [] // provider agrees failed/pending/reversed — refund OK
  const noRecord = []    // provider has NO record (SP106) — never initiated → refund OK
  let errored = []       // genuine transient error (timeout/network) — retry

  const classify = (d) => {
    const msg = (d && (d.message || (d.data && d.data.status_message) || '')).toLowerCase()
    const notFound = d && (d.code === 'SP106' || msg.includes('not found'))
    if (isGenuineProviderSuccess(d)) return 'success'
    if (notFound) return 'norecord'
    if (d && d.code === 'LOCAL_ERROR') return 'error'
    if (d && d.status !== 'SUCCESS' && !d.data) return 'error'
    return 'failed'
  }

  async function run(list, label) {
    let i = 0, done = 0
    const retry = []
    async function worker() {
      while (i < list.length) {
        const r = list[i++]
        const d = await providerStatus(r.reference_id)
        const cls = classify(d)
        if (cls === 'success') confirmed.push({ ...r, prov_utr: d.data.utr, prov_txn_status: d.data.txn_status, prov_amt: d.data.trans_amount })
        else if (cls === 'norecord') noRecord.push(r)
        else if (cls === 'error') retry.push({ ...r, prov_msg: d.message || d.code })
        else stillFailed.push({ ...r, prov_txn_status: d && d.data && d.data.txn_status })
        done++
        if (done % 200 === 0) process.stderr.write(`  ${label} ...${done}/${list.length}\n`)
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    return retry
  }

  errored = await run(rows, 'pass1')
  // Retry transient errors up to 2 more times (timeouts/network blips).
  for (let attempt = 2; attempt <= 3 && errored.length; attempt++) {
    process.stderr.write(`  retry pass ${attempt}: ${errored.length} transient errors\n`)
    await new Promise((r) => setTimeout(r, 3000))
    errored = await run(errored, `pass${attempt}`)
  }

  const money = (v) => parseFloat(v || 0)
  const total = confirmed.reduce((s, r) => s + money(r.refund_credit), 0)

  console.log(`\n================ RESULT ================`)
  console.log(`Refunded but provider says SUCCESS (CONFIRMED double-money): ${confirmed.length}  → ₹${total.toFixed(2)}`)
  console.log(`Provider agrees failed/pending/reversed (refund correct):    ${stillFailed.length}`)
  console.log(`Provider has NO record — never initiated (refund correct):   ${noRecord.length}`)
  console.log(`Still could not verify after retries (needs manual recheck):  ${errored.length}`)

  if (confirmed.length) {
    console.log(`\n--- CONFIRMED double-money (verify + claw back) ---`)
    console.log(`reference_id | wallet retailer_id | refunded | provider_utr | provider_txn_status | our_msg | created_at`)
    for (const r of confirmed) {
      console.log(`${r.reference_id} | ${r.wallet} ${r.retailer_id} | ₹${money(r.refund_credit).toFixed(2)} | ${r.prov_utr} | "${r.prov_txn_status}" | "${r.status_message}" | ${new Date(r.created_at).toISOString()}`)
    }
    const outPath = path.join(process.cwd(), `shadval-confirmed-double-money-${Date.now()}.json`)
    fs.writeFileSync(outPath, JSON.stringify(confirmed, null, 2))
    console.log(`\nDetails written to ${outPath}`)
    console.log(`reference_ids:\n${confirmed.map((r) => r.reference_id).join('\n')}`)
  }

  if (errored.length) {
    console.log(`\n--- Could not verify (retry later) ---`)
    for (const r of errored.slice(0, 50)) console.log(`${r.reference_id} | ${r.prov_msg}`)
    if (errored.length > 50) console.log(`  ...and ${errored.length - 50} more`)
  }

  console.log(`\nREAD-ONLY report. No records changed.`)
  await c.end()
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1) })
