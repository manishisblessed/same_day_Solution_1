/**
 * Sync the bookkeeping columns on razorpay_pos_transactions for the 28 corrected
 * DIS64443281 txns so reports that read the txn row (not the ledger) match the
 * corrected commission. Sets distributor_commission_gross/tds/net and repoints
 * distributor_commission_id to the FIX ledger row. Idempotent; single txn.
 *
 * Run: node scripts/sync-txn-commission-cols-dis64443281.mjs
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
function normalizeBrand(b) { if (!b) return null; const n = b.toUpperCase().replace(/[\s_-]+/g, ''); const A = { MASTERCARD: 'MASTERCARD', MASTER: 'MASTERCARD', MC: 'MASTERCARD', VISA: 'VISA', AMEX: 'AMEX', AMERICANEXPRESS: 'AMEX', RUPAY: 'RUPAY', DINERS: 'DINERS', DINERSCLUB: 'DINERS', MAESTRO: 'MAESTRO', JCB: 'JCB', DISCOVER: 'DISCOVER' }; return A[n] || n || null }
const normCard = (ct) => { const u = (ct || '').toUpperCase(); return ['CREDIT', 'DEBIT', 'PREPAID'].includes(u) ? u : null }
const normMode = (m) => { const u = (m || 'CARD').toUpperCase(); return u.includes('UPI') ? 'UPI' : 'CARD' }

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const rateRows = (await c.query(`select mode, card_type, brand_type, card_classification, merchant_slug, retailer_mdr_t1::float8 r_t1, coalesce(distributor_cost_mdr_t1,distributor_mdr_t1)::float8 d_t1 from scheme_mdr_rates where scheme_id=$1 and status='active'`, [SCHEME])).rows
function resolveRate({ mode, cardType, brand, classification, company }) {
  const find = (m, ct, bt, cc, co) => rateRows.find(r => r.mode === m && (ct ? r.card_type === ct : r.card_type === null) && (bt ? (r.brand_type || '').toUpperCase() === bt.toUpperCase() || (r.brand_type || '').toUpperCase() === (normalizeBrand(bt) || '') : r.brand_type === null) && (cc ? (r.card_classification || '').toUpperCase() === cc.toUpperCase() : r.card_classification === null) && (co ? r.merchant_slug === co : r.merchant_slug === null))
  const tryCompany = (co) => { if (cardType && brand && classification) { const h = find(mode, cardType, brand, classification, co); if (h) return h } if (cardType && brand) { const h = find(mode, cardType, brand, null, co); if (h) return h } if (cardType) { const h = find(mode, cardType, null, null, co); if (h) return h } return find(mode, null, null, null, co) }
  let hit = company ? tryCompany(company) : null; if (!hit) hit = tryCompany(null); return hit
}

const txns = (await c.query(`select t.id, t.txn_id, t.card_brand, t.card_type, t.card_classification, t.merchant_slug, coalesce(t.payment_mode,'CARD') payment_mode, coalesce(t.gross_amount,t.amount)::float8 gross, l.credit::float8 ledger_credit from razorpay_pos_transactions t left join wallet_ledger l on l.id=t.distributor_commission_id where t.retailer_id=any($1) and t.settlement_mode='AUTO_T1' and t.transaction_time>=$2`, [RETAILERS, SINCE])).rows

let updated = 0
await c.query('BEGIN')
try {
  for (const t of txns) {
    const rate = resolveRate({ mode: normMode(t.payment_mode), cardType: normCard(t.card_type), brand: normalizeBrand(t.card_brand), classification: t.card_classification || null, company: (t.merchant_slug || '').toLowerCase().trim() || null })
    if (!rate) { throw new Error(`no rate for ${t.txn_id}`) }
    const marginPct = Math.max(rate.r_t1 - rate.d_t1, 0)
    const correctGross = round4((t.gross * marginPct) / 100)
    const correctTds = round2(correctGross * TDS_RATE)
    const correctNet = round2(correctGross - correctTds)
    const prevNet = round2(t.ledger_credit != null ? t.ledger_credit : 0)
    if (Math.abs(round2(correctNet - prevNet)) < 0.01) continue // untouched (already correct) rows

    const fix = (await c.query(`select id from wallet_ledger where retailer_id=$1 and reference_id=$2 limit 1`, [DIST, `AUTO-T1-COMM-FIX-${t.txn_id}`])).rows[0]
    await c.query(
      `update razorpay_pos_transactions set distributor_commission_gross=$1, distributor_tds=$2, distributor_commission_net=$3, distributor_commission_id=coalesce($4, distributor_commission_id) where id=$5`,
      [correctGross, correctTds, correctNet, fix?.id || null, t.id]
    )
    updated++
  }
  await c.query('COMMIT')
} catch (e) { await c.query('ROLLBACK'); console.error('ROLLED BACK:', e.message); await c.end(); process.exit(1) }
console.log(`Updated bookkeeping columns on ${updated} transaction(s).`)
await c.end()
