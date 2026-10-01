const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: path.join(process.cwd(), '.env.local') })
const { Client } = require('pg')

const SQL_FILE = 'supabase-pay2new-idempotency-and-webhook-migration.sql'

;(async () => {
  const conn = process.env.DATABASE_URL
  if (!conn) {
    console.error('DATABASE_URL not set')
    process.exit(1)
  }
  const sql = fs.readFileSync(path.join(process.cwd(), SQL_FILE), 'utf8')
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query(sql)
    await client.query('COMMIT')
    console.log('✅ Migration applied successfully')

    // Verify the columns, index, and constraint now exist.
    const cols = await client.query(
      `select column_name from information_schema.columns
       where table_name='partner_wallet_ledger' and column_name in ('bill_fetch_ref','client_ref')
       order by column_name`
    )
    const idx = await client.query(
      `select indexname from pg_indexes
       where tablename='partner_wallet_ledger'
       and indexname in ('uniq_pwl_pay2new_debit_bill_fetch_ref','idx_pwl_pay2new_client_ref')
       order by indexname`
    )
    const con = await client.query(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conname='partner_webhooks_events_valid'`
    )
    console.log('columns:', cols.rows.map((r) => r.column_name).join(', ') || '(none)')
    console.log('indexes:', idx.rows.map((r) => r.indexname).join(', ') || '(none)')
    console.log('constraint:', con.rows[0] ? con.rows[0].def : '(none)')
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('❌ Migration FAILED:', e.message)
    process.exitCode = 1
  } finally {
    await client.end()
  }
})()
