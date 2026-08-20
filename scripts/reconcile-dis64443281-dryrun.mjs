/**
 * DRY-RUN (READ-ONLY) commission reconciliation for distributor DIS64443281.
 *
 * For every POS txn of RET89082401 (Rameshwar) and RET67853413 (Nishant Shakya)
 * captured on/after 2026-08-05 IST and auto-settled (AUTO_T1), it:
 *   - resolves the CURRENT scheme rate row using the SAME fallback chain as
 *     lib/mdr-scheme/settlement.service.ts::calculateMDR (cascade model),
 *   - computes the CORRECT distributor commission = gross * (retailer_mdr - distributor_mdr)%
 *     net of 2% TDS (rounded exactly like settle_pos_txn_t1),
 *   - reads the commission ACTUALLY credited to DIS64443281 for that txn,
 *   - prints prev_net, correct_net and delta per transaction + totals.
 *
 * NOTHING IS WRITTEN. Run: node scripts/reconcile-dis64443281-dryrun.mjs
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
const SINCE = '2026-08-04T18:30:00.000Z' // Aug 5 2026 00:00 IST
const TDS_RATE = 0.02

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

// Preload the scheme rate rows once (small table) and resolve in JS.
const rateRows = (await c.query(
  `select mode, card_type, brand_type, card_classification, merchant_slug,
          retailer_mdr_t1::float8 r_t1, distributor_mdr_t1::float8 d_t1, partner_mdr
   from scheme_mdr_rates where scheme_id=$1 and status='active'`,
  ['004d4657-d2f0-4bf4-927f-60061fd4a104']
)).rows

// Faithful port of calculateMDR's scheme_mdr_rates fallback (T1 cascade).
function resolveRate({ mode, cardType, brand, classification, company }) {
  const find = (m, ct, bt, cc, co) => rateRows.find(r =>
    r.mode === m &&
    (ct ? r.card_type === ct : r.card_type === null) &&
    (bt ? (r.brand_type || '').toUpperCase() === bt.toUpperCase() || (r.brand_type || '').toUpperCase() === (normalizeBrand(bt) || '') : r.brand_type === null) &&
    (cc ? (r.card_classification || '').toUpperCase() === cc.toUpperCase() : r.card_classification === null) &&
    (co ? r.merchant_slug === co : r.merchant_slug === null)
  )
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
          t.mdr_rate::float8 mdr_rate,
          t.distributor_commission_gross::float8 prev_gross,
          t.distributor_commission_net::float8 prev_net_col,
          t.transaction_time,
          l.id ledger_id, l.credit::float8 ledger_credit, l.reference_id
   from razorpay_pos_transactions t
   left join wallet_ledger l on l.id = t.distributor_commission_id
   where t.retailer_id = any($1) and t.settlement_mode='AUTO_T1' and t.transaction_time >= $2
   order by t.retailer_id, t.transaction_time`,
  [RETAILERS, SINCE]
)).rows

const rows = []
const totals = { prev: 0, correct: 0, delta: 0 }
const perRetailer = {}
let warns = []

for (const t of txns) {
  const brand = normalizeBrand(t.card_brand)
  const rate = resolveRate({
    mode: normMode(t.payment_mode), cardType: normCard(t.card_type),
    brand, classification: t.card_classification || null,
    company: (t.merchant_slug || '').toLowerCase().trim() || null,
  })

  let correctGross = 0, marginPct = 0, retMdr = null, distMdr = null
  if (!rate) {
    warns.push(`NO RATE resolved for ${t.txn_id} (${t.card_brand}/${t.merchant_slug})`)
  } else {
    retMdr = rate.r_t1; distMdr = rate.d_t1
    marginPct = Math.max(retMdr - distMdr, 0)
    correctGross = round4((t.gross * marginPct) / 100)
    // Cross-check stored retailer mdr vs resolved
    if (t.mdr_rate != null && Math.abs(t.mdr_rate - retMdr) > 0.0001) {
      warns.push(`MDR mismatch ${t.txn_id}: stored ${t.mdr_rate} vs resolved ${retMdr}`)
    }
  }
  const correctTds = round2(correctGross * TDS_RATE)
  const correctNet = round2(correctGross - correctTds)

  const prevNet = t.ledger_credit != null ? t.ledger_credit : (t.prev_net_col || 0)
  const delta = round2(correctNet - prevNet)

  totals.prev = round2(totals.prev + prevNet)
  totals.correct = round2(totals.correct + correctNet)
  totals.delta = round2(totals.delta + delta)
  const pr = (perRetailer[t.retailer_id] ||= { txns: 0, prev: 0, correct: 0, delta: 0 })
  pr.txns++; pr.prev = round2(pr.prev + prevNet); pr.correct = round2(pr.correct + correctNet); pr.delta = round2(pr.delta + delta)

  rows.push({
    retailer: t.retailer_id,
    txn_id: t.txn_id,
    date: new Date(t.transaction_time).toISOString().slice(0, 10),
    brand: t.card_brand,
    company: t.merchant_slug,
    gross: t.gross,
    margin_pct: marginPct,
    correct_gross: correctGross,
    correct_net: correctNet,
    prev_net: round2(prevNet),
    delta,
    ledger: t.ledger_id ? 'yes' : 'MISSING',
  })
}

console.log(`\n================ PER-TRANSACTION DRY-RUN (DIS64443281) ================`)
console.log(`Scope: RET89082401 + RET67853413 | AUTO_T1 | txn_time >= ${SINCE} | ${rows.length} txns`)
console.table(rows)

console.log(`\n================ PER-RETAILER SUMMARY ================`)
console.table(perRetailer)

console.log(`\n================ GRAND TOTALS ================`)
console.table([{
  txns: rows.length,
  prev_net_credited: totals.prev,
  correct_net_due: totals.correct,
  net_delta: totals.delta,
  action: totals.delta < 0 ? `PULL BACK ₹${Math.abs(totals.delta)} (overpaid)` : `CREDIT ₹${totals.delta} (underpaid)`,
}])

if (warns.length) { console.log(`\n!!! WARNINGS (${warns.length}) !!!`); warns.forEach(w => console.log(' -', w)) }
else console.log('\nNo resolution/mdr warnings.')

await c.end()
