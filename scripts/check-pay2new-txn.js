/**
 * Check the real status of a Pay2New (BBPS-2 Credit Card) partner transaction.
 *
 * Looks up our source-of-truth ledger row + any refund, then queries Pay2New's
 * live transactionStatus API. The `request_id` we send Pay2New is the same
 * value we store as partner_wallet_ledger.reference_id (e.g. SDS1785484676100).
 *
 * Usage (from the app root so .env is picked up):
 *   node scripts/check-pay2new-txn.js SDS1785484676100
 *
 * Needs env: DATABASE_URL, PAY2NEW_BASE_URL (default https://pay2new.in),
 *            PAY2NEW_SECRET.
 */

const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

// Load .env from cwd or ./sameday-backend without needing dotenv installed.
function loadEnv() {
  for (const p of [
    '.env.local',
    '.env',
    path.join('sameday-backend', '.env.local'),
    path.join('sameday-backend', '.env'),
  ]) {
    try {
      const full = path.resolve(p)
      if (!fs.existsSync(full)) continue
      for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
        const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
        if (!m) continue
        const key = m[1]
        let val = m[2].replace(/^['"]|['"]$/g, '')
        if (process.env[key] === undefined) process.env[key] = val
      }
    } catch {}
  }
}
loadEnv()

const REQUEST_ID = process.argv[2] || 'SDS1785484676100'
const DB_URL = process.env.DATABASE_URL
const BASE = (process.env.PAY2NEW_BASE_URL || 'https://pay2new.in').replace(/\/$/, '')
const SECRET = process.env.PAY2NEW_SECRET || ''

const money = (n) =>
  `₹${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`

async function dbLookup() {
  if (!DB_URL) {
    console.log('DATABASE_URL not set — skipping DB lookup.')
    return
  }
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const { rows } = await c.query(
      `select * from partner_wallet_ledger
        where reference_id in ($1, $2)
        order by created_at asc`,
      [REQUEST_ID, `REFUND_${REQUEST_ID}`]
    )
    if (rows.length === 0) {
      console.log(`No ledger rows for ${REQUEST_ID}. (Wrong reference or different partner env?)`)
      return
    }
    const bal = (r) => r.balance_after ?? r.running_balance ?? r.balance ?? r.closing_balance
    console.log('--- Ledger (source of truth) ---')
    for (const r of rows) {
      const isRefund = String(r.reference_id).startsWith('REFUND_')
      const ts = r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at
      console.log(
        [
          `  ${isRefund ? 'REFUND ' : 'DEBIT  '} ${ts}`,
          `partner=${r.partner_id}`,
          `type=${r.transaction_type}`,
          r.credit ? `credit=${money(r.credit)}` : `debit=${money(r.debit)}`,
          bal(r) != null ? `bal_after=${money(bal(r))}` : '',
          `status=${r.status || 'n/a'}`,
          `payout_txn_id=${r.payout_transaction_id || 'null'}`,
        ].filter(Boolean).join('  ')
      )
      console.log(`      desc: ${r.description}`)
    }
    const debit = rows.find((r) => !String(r.reference_id).startsWith('REFUND_'))
    const refund = rows.find((r) => String(r.reference_id).startsWith('REFUND_'))
    console.log('\n--- Interpretation ---')
    if (refund) {
      console.log('  REFUND entry present -> provider payment FAILED and wallet was auto-refunded.')
    } else if (debit && String(debit.payout_transaction_id || '').startsWith('FAILED:')) {
      console.log('  payout_transaction_id=FAILED: -> provider call failed. Check for a matching refund!')
    } else if (debit && debit.payout_transaction_id) {
      console.log(`  Has provider OrderID=${debit.payout_transaction_id} -> provider accepted the payment.`)
    } else {
      console.log('  No OrderID and no refund -> STUCK/PENDING: debit happened but success-update never ran.')
      console.log('  Verify with the provider status below before any manual refund.')
    }
  } finally {
    await c.end()
  }
}

async function providerStatus() {
  console.log('\n--- Pay2New live transactionStatus ---')
  if (!SECRET) {
    console.log('PAY2NEW_SECRET not set — skipping provider check.')
    return
  }
  try {
    const res = await fetch(`${BASE}/apis/v1/transactionStatus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', secret: SECRET },
      body: JSON.stringify({ client_txn_id: REQUEST_ID }),
    })
    const text = await res.text()
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      console.log(`  HTTP ${res.status} non-JSON:`, text.slice(0, 400))
      return
    }
    console.log(`  HTTP ${res.status}:`, JSON.stringify(parsed, null, 2))
    const tx = String(parsed.transaction_status || '').toUpperCase()
    if (tx) console.log(`  => Provider transaction_status: ${tx}`)
  } catch (e) {
    console.log('  Provider request error:', e.message)
  }
}

;(async () => {
  console.log(`Checking Pay2New txn request_id=${REQUEST_ID}\n`)
  await dbLookup()
  await providerStatus()
})().catch((e) => {
  console.error('FATAL:', e.message)
  process.exit(1)
})
