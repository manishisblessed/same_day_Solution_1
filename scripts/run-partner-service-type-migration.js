/* eslint-disable */
// One-off runner for supabase-partner-ledger-service-type-migration.sql
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL not set in .env.local')

  const sqlPath = path.join(__dirname, '..', 'supabase-partner-ledger-service-type-migration.sql')
  const sql = fs.readFileSync(sqlPath, 'utf8')

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  console.log('Connected. Running migration…')
  try {
    await client.query('BEGIN')
    await client.query(sql)
    await client.query('COMMIT')
    console.log('✅ Migration committed.')

    const { rows } = await client.query(
      `SELECT COALESCE(service_type, '(null)') AS service_type, COUNT(*)::int AS n
       FROM partner_wallet_ledger GROUP BY service_type ORDER BY n DESC`
    )
    console.log('partner_wallet_ledger by service_type:')
    console.table(rows)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    await client.end()
  }
}

main().catch((e) => { console.error('❌', e.message); process.exit(1) })
