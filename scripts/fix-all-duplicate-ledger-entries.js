const { Client } = require('pg')
const DB_URL = 'postgresql://postgres.ohmvvtnfdvvatgofrzta:Development%400022122025@aws-1-ap-south-1.pooler.supabase.com:5432/postgres'

async function main() {
  const c = new Client(DB_URL)
  await c.connect()

  // 1. Unique index on subscription_debits: one completed debit per subscription per billing period
  console.log('Adding unique constraint: one completed debit per subscription per billing period...')
  await c.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_debits_one_per_period
    ON subscription_debits (subscription_id, billing_period_start)
    WHERE status = 'completed'
  `)
  console.log('  Done.')

  // 2. Verify the existing wallet_ledger dedup index still exists
  const { rows: idxCheck } = await c.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'wallet_ledger'
      AND indexname = 'idx_wallet_ledger_reference_id_user_unique'
  `)
  console.log(`wallet_ledger dedup index: ${idxCheck.length > 0 ? 'EXISTS' : 'MISSING — NEEDS ATTENTION'}`)

  await c.end()
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
