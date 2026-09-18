/* READ-ONLY: distinct brands/classifications settlement actually sees. */
const { Client } = require('pg')
const fs = require('fs'), path = require('path')
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
function normalizeBrandType(brand) {
  if (!brand) return null
  const n = brand.toUpperCase().replace(/[\s_-]+/g, '')
  const A = { MASTERCARD:'MASTERCARD', MASTER:'MASTERCARD', MC:'MASTERCARD', VISA:'VISA', AMEX:'AMEX', AMERICANEXPRESS:'AMEX', RUPAY:'RUPAY', DINERS:'DINERS', DINERSCLUB:'DINERS', MAESTRO:'MAESTRO', JCB:'JCB', DISCOVER:'DISCOVER' }
  return A[n] || n || null
}
;(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const q = async (label, sql) => { const r = await c.query(sql); console.log(`\n=== ${label} ===`); console.table(r.rows); return r.rows }
  const brands = await q('distinct card_brand in txns (last 90d)', `
    select card_brand, count(*) n from razorpay_pos_transactions
    where created_at > now() - interval '90 days' and card_brand is not null
    group by card_brand order by n desc`)
  console.log('normalized brand set →', [...new Set(brands.map(b => normalizeBrandType(b.card_brand)))].join(', '))
  await q('distinct card_classification in txns (last 90d)', `
    select card_classification, count(*) n from razorpay_pos_transactions
    where created_at > now() - interval '90 days' and card_classification is not null
    group by card_classification order by n desc`)
  await c.end()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
