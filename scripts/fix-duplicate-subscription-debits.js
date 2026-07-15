const { Client } = require('pg')
const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error('DATABASE_URL environment variable is required'); process.exit(1) }

async function main() {
  const c = new Client(DB_URL)
  await c.connect()
  const { rows } = await c.query(`
    SELECT retailer_id, credit, description, created_at
    FROM wallet_ledger
    WHERE reference_id LIKE 'SUBDUP_REFUND_%'
    ORDER BY created_at DESC
  `)
  console.log('Subscription duplicate refunds in ledger:')
  for (const r of rows) {
    console.log(`  ${r.retailer_id} | +₹${r.credit} | ${r.description}`)
  }
  await c.end()
}
main().catch(e => { console.error(e.message); process.exit(1) })
