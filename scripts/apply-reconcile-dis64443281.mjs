/**
 * APPLY commission reconciliation for distributor DIS64443281 (WRITES MONEY).
 *
 * For each over-paid POS txn (Aug 6-10 bug window) of RET89082401 + RET67853413,
 * within a SINGLE DB transaction (all-or-nothing):
 *   1. COMMISSION_REVERSAL debit of the wrongly-credited net.
 *   2. DISTRIBUTOR_COMMISSION credit of the correct net (per current scheme, net 2% TDS).
 *
 * Idempotent: unique REV/FIX reference_ids; already-applied txns are skipped.
 * Only touches rows where |correct_net - prev_net| >= 0.01. No retailer/txn rows changed.
 *
 * Run: node scripts/apply-reconcile-dis64443281.mjs
 */
import { Client } from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const DIST = 'DIS64443281'
const RETAILERS = ['RET89082401', 'RET67853413']
const SINCE = '2026-08-04T18:30:00.000Z'
const TDS_RATE = 0.02
const SCHEME = '004d4657-d2f0-4bf4-927f-60061fd4a104'

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
const round4 = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000
function normalizeBrand(brand) {
  if (!brand) return null
  const n = brand.toUpperCase().replace(/[\s_-]+/g, '')
  const A = { MASTERCARD: 'MASTERCARD', MASTER: 'MASTERCARD', MC: 'MASTERCARD', VISA: 'VISA', AMEX: 'AMEX', AMERICANEXPRESS: 'AMEX', RUPAY: 'RUPAY', DINERS: 'DINERS', DINERSCLUB: 'DINERS', MAESTRO: 'MAESTRO', JCB: 'JCB', DISCOVER: 'DISCOVER' }
  return A[n] || n || null
}
const normCard = (ct) => { const u = (ct || '').toUpperCase(); return ['CREDIT', 'DEBIT', 'PREPAID'].includes(u) ? u : null }
const normMode = (m) => { const u = (m || 'CARD').toUpperCase(); return u.includes('UPI') ? 'UPI' : 'CARD' }

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const rateRows = (await c.query(
  `select mode, card_type, brand_type, card_classification, merchant_slug,
          retailer_mdr_t1::float8 r_t1,
          distributor_mdr_t1::float8 d_t1
   from scheme_mdr_rates where scheme_id=$1 and status='active'`, [SCHEME]
)).rows
function resolveRate({ mode, cardType, brand, classification, company }) {
  const find = (m, ct, bt, cc, co) => rateRows.find(r =>
    r.mode === m && (ct ? r.card_type === ct : r.card_type === null) &&
    (bt ? (r.brand_type || '').toUpperCase() === bt.toUpperCase() || (r.brand_type || '').toUpperCase() === (normalizeBrand(bt) || '') : r.brand_type === null) &&
    (cc ? (r.card_classification || '').toUpperCase() === cc.toUpperCase() : r.card_classification === null) &&
    (co ? r.merchant_slug === co : r.merchant_slug === null))
  const tryCompany = (co) => {
    if (cardType && brand && classification) { const h = find(mode, cardType, brand, classification, co); if (h) return h }
    if (cardType && brand) { const h = find(mode, cardType, brand, null, co); if (h) return h }
    if (cardType) { const h = find(mode, cardType, null, null, co); if (h) return h }
    return find(mode, null, null, null, co)
  }
  let hit = company ? tryCompany(company) : null
  if (!hit) hit = tryCompany(null)
  return hit
}

const txns = (await c.query(
  `select t.id, t.txn_id, t.tid, t.retailer_id, t.card_brand, t.card_type, t.card_classification,
          t.merchant_slug, coalesce(t.payment_mode,'CARD') payment_mode,
          coalesce(t.gross_amount, t.amount)::float8 gross,
          l.id ledger_id, l.credit::float8 ledger_credit
   from razorpay_pos_transactions t
   left join wallet_ledger l on l.id = t.distributor_commission_id
   where t.retailer_id = any($1) and t.settlement_mode='AUTO_T1' and t.transaction_time >= $2
   order by t.retailer_id, t.transaction_time`, [RETAILERS, SINCE]
)).rows

// Build the work list (only non-zero deltas).
const work = []
for (const t of txns) {
  const rate = resolveRate({
    mode: normMode(t.payment_mode), cardType: normCard(t.card_type),
    brand: normalizeBrand(t.card_brand), classification: t.card_classification || null,
    company: (t.merchant_slug || '').toLowerCase().trim() || null,
  })
  if (!rate) { console.error(`ABORT: no rate for ${t.txn_id}`); process.exit(1) }
  const marginPct = Math.max(rate.r_t1 - rate.d_t1, 0)
  const correctGross = round4((t.gross * marginPct) / 100)
  const correctTds = round2(correctGross * TDS_RATE)
  const correctNet = round2(correctGross - correctTds)
  const prevNet = round2(t.ledger_credit != null ? t.ledger_credit : 0)
  const delta = round2(correctNet - prevNet)
  if (Math.abs(delta) < 0.01) continue
  work.push({ ...t, marginPct, correctGross, correctTds, correctNet, prevNet, delta })
}

// Skip already-applied (idempotency).
const refs = work.flatMap(w => [`AUTO-T1-COMM-REV-${w.txn_id}`, `AUTO-T1-COMM-FIX-${w.txn_id}`])
const applied = new Set((await c.query(
  `select reference_id from wallet_ledger where retailer_id=$1 and reference_id = any($2)`, [DIST, refs]
)).rows.map(r => r.reference_id))

const before = (await c.query(`select balance::float8 b from wallets where user_id=$1 and wallet_type='primary'`, [DIST])).rows[0]?.b ?? 0

console.log(`Distributor ${DIST} opening balance: ₹${before}`)
console.log(`Txns needing correction: ${work.length}`)

let reversed = 0, recredited = 0, revSum = 0, credSum = 0, skipped = 0
await c.query('BEGIN')
try {
  for (const w of work) {
    const revRef = `AUTO-T1-COMM-REV-${w.txn_id}`
    const fixRef = `AUTO-T1-COMM-FIX-${w.txn_id}`

    if (!applied.has(revRef) && w.prevNet > 0) {
      await c.query(
        `select add_ledger_entry($1,'distributor','primary','online','pos_commission','COMMISSION_REVERSAL',0,$2,$3,$4,'completed',$5)`,
        [DIST, w.prevNet, revRef, w.id,
         `Reversal of over-credited POS commission (bug Aug 6-10) - ${w.txn_id}, TID ${w.tid || 'N/A'}, was Rs.${w.prevNet}`]
      )
      reversed++; revSum = round2(revSum + w.prevNet)
    } else skipped++

    if (!applied.has(fixRef) && w.correctNet > 0) {
      await c.query(
        `select add_ledger_entry($1,'distributor','primary','online','pos_commission','DISTRIBUTOR_COMMISSION',$2,0,$3,$4,'completed',$5)`,
        [DIST, w.correctNet, fixRef, w.id,
         `Corrected POS commission per current scheme - ${w.txn_id}, TID ${w.tid || 'N/A'}, Gross: Rs.${w.gross}, Rate: ${w.marginPct}%, TDS: Rs.${w.correctTds}, Net: Rs.${w.correctNet}`]
      )
      recredited++; credSum = round2(credSum + w.correctNet)
    }
  }
  await c.query('COMMIT')
} catch (e) {
  await c.query('ROLLBACK')
  console.error('\nROLLED BACK — no changes applied. Error:', e.message)
  await c.end(); process.exit(1)
}

const after = (await c.query(`select balance::float8 b from wallets where user_id=$1 and wallet_type='primary'`, [DIST])).rows[0]?.b ?? 0

console.log(`\n=== APPLIED (committed) ===`)
console.table([{
  reversals: reversed, reversed_total: revSum,
  recredits: recredited, recredited_total: credSum,
  net_change: round2(credSum - revSum),
  skipped_already_applied: skipped,
  balance_before: before, balance_after: after,
}])

await c.end()
