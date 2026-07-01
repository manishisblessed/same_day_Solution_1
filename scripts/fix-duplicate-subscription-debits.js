const { Client } = require('pg')
const DB_URL = 'postgresql://postgres.ohmvvtnfdvvatgofrzta:Development%400022122025@aws-1-ap-south-1.pooler.supabase.com:5432/postgres'

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
