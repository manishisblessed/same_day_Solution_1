/**
 * READ-ONLY platform-wide POS commission audit.
 *
 * For every AUTO_T1-settled POS txn, recompute the CORRECT distributor commission
 * per the retailer's CURRENT scheme (same cascade fallback as calculateMDR) and
 * compare to what was actually credited (via distributor_commission_id ledger
 * link). Group by distributor; flag any with a material net delta.
 *
 * Nothing is written. Run: node scripts/audit-pos-commission-all.mjs
 */
import { Client } from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
const TDS_RATE = 0.02
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
const round4 = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000
function normalizeBrand(b) { if (!b) return null; const n = b.toUpperCase().replace(/[\s_-]+/g, ''); const A = { MASTERCARD: 'MASTERCARD', MASTER: 'MASTERCARD', MC: 'MASTERCARD', VISA: 'VISA', AMEX: 'AMEX', AMERICANEXPRESS: 'AMEX', RUPAY: 'RUPAY', DINERS: 'DINERS', DINERSCLUB: 'DINERS', MAESTRO: 'MAESTRO', JCB: 'JCB', DISCOVER: 'DISCOVER' }; return A[n] || n || null }
const normCard = (ct) => { const u = (ct || '').toUpperCase(); return ['CREDIT', 'DEBIT', 'PREPAID'].includes(u) ? u : null }
const normMode = (m) => { const u = (m || 'CARD').toUpperCase(); return u.includes('UPI') ? 'UPI' : 'CARD' }

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

// Resolve + cache each retailer's active scheme rate rows.
const schemeRatesCache = new Map() // scheme_id -> rows
const retailerScheme = new Map()   // retailer_id -> { schemeId, rows } | null
async function getRetailerRates(retailerId, distId, mdId) {
  if (retailerScheme.has(retailerId)) return retailerScheme.get(retailerId)
  const rs = (await c.query(`select scheme_id from resolve_scheme_for_user($1,'retailer','mdr',$2,$3) limit 1`, [retailerId, distId, mdId])).rows[0]
  if (!rs?.scheme_id) { retailerScheme.set(retailerId, null); return null }
  if (!schemeRatesCache.has(rs.scheme_id)) {
    const rows = (await c.query(`select mode, card_type, brand_type, card_classification, merchant_slug, retailer_mdr_t1::float8 r_t1, coalesce(distributor_cost_mdr_t1,distributor_mdr_t1)::float8 d_t1, partner_mdr from scheme_mdr_rates where scheme_id=$1 and status='active'`, [rs.scheme_id])).rows
    schemeRatesCache.set(rs.scheme_id, rows)
  }
  const val = { schemeId: rs.scheme_id, rows: schemeRatesCache.get(rs.scheme_id) }
  retailerScheme.set(retailerId, val)
  return val
}
function resolveRate(rows, { mode, cardType, brand, classification, company }) {
  const find = (m, ct, bt, cc, co) => rows.find(r => r.mode === m && (ct ? r.card_type === ct : r.card_type === null) && (bt ? (r.brand_type || '').toUpperCase() === bt.toUpperCase() || (r.brand_type || '').toUpperCase() === (normalizeBrand(bt) || '') : r.brand_type === null) && (cc ? (r.card_classification || '').toUpperCase() === cc.toUpperCase() : r.card_classification === null) && (co ? r.merchant_slug === co : r.merchant_slug === null))
  const tryCompany = (co) => { if (cardType && brand && classification) { const h = find(mode, cardType, brand, classification, co); if (h) return h } if (cardType && brand) { const h = find(mode, cardType, brand, null, co); if (h) return h } if (cardType) { const h = find(mode, cardType, null, null, co); if (h) return h } return find(mode, null, null, null, co) }
  let hit = company ? tryCompany(company) : null; if (!hit) hit = tryCompany(null); return hit
}

const txns = (await c.query(`
  select t.txn_id, t.retailer_id, r.distributor_id, r.master_distributor_id,
         t.card_brand, t.card_type, t.card_classification, t.merchant_slug,
         coalesce(t.payment_mode,'CARD') payment_mode,
         coalesce(t.gross_amount,t.amount)::float8 gross,
         l.credit::float8 credited_net,
         t.distributor_commission_net::float8 col_net
  from razorpay_pos_transactions t
  join retailers r on r.partner_id = t.retailer_id
  left join wallet_ledger l on l.id = t.distributor_commission_id
  where t.settlement_mode='AUTO_T1' and r.distributor_id is not null
`)).rows

console.log(`Auditing ${txns.length} AUTO_T1 txns with a distributor...`)

const byDist = new Map()
let unresolved = 0
for (const t of txns) {
  const sch = await getRetailerRates(t.retailer_id, t.distributor_id, t.master_distributor_id)
  const g = byDist.get(t.distributor_id) || { txns: 0, credited: 0, correct: 0, delta: 0, anomalies: 0, legacy: 0 }
  g.txns++
  const credited = round2(t.credited_net != null ? t.credited_net : (t.col_net || 0))
  g.credited = round2(g.credited + credited)

  if (!sch || sch.rows.length === 0) { g.legacy++; unresolved++; byDist.set(t.distributor_id, g); continue }
  const rate = resolveRate(sch.rows, { mode: normMode(t.payment_mode), cardType: normCard(t.card_type), brand: normalizeBrand(t.card_brand), classification: t.card_classification || null, company: (t.merchant_slug || '').toLowerCase().trim() || null })
  if (!rate) { g.legacy++; unresolved++; byDist.set(t.distributor_id, g); continue }
  const marginPct = rate.partner_mdr != null ? 0 : Math.max(rate.r_t1 - rate.d_t1, 0)
  const correctGross = round4((t.gross * marginPct) / 100)
  const correctNet = round2(correctGross - round2(correctGross * TDS_RATE))
  g.correct = round2(g.correct + correctNet)
  const d = round2(correctNet - credited)
  g.delta = round2(g.delta + d)
  if (Math.abs(d) >= 0.01) g.anomalies++
  byDist.set(t.distributor_id, g)
}

const out = [...byDist.entries()]
  .map(([distributor_id, v]) => ({ distributor_id, ...v }))
  .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

console.log('\n=== PER-DISTRIBUTOR (sorted by |net delta|) ===')
console.table(out)

const flagged = out.filter(o => Math.abs(o.delta) >= 1)
console.log('\n=== FLAGGED (|delta| >= Rs.1) ===')
console.table(flagged.length ? flagged : [{ note: 'none' }])
console.log(`\nRetailers with unresolved/legacy-path rates (couldn't recompute): ${unresolved} txns`)
await c.end()
