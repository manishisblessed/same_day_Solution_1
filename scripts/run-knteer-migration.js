const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const envPath = path.join(process.cwd(), '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
const env = {}
envContent.split('\n').forEach(function(line) {
  if (line.startsWith('#') || !line.includes('=')) return
  var idx = line.indexOf('=')
  env[line.substring(0, idx).trim()] = line.substring(idx + 1).trim()
})

const { Client } = require('pg')
const connStr = env.SUPABASE_DB_URL || env.DATABASE_URL

async function main() {
  if (!connStr) {
    console.log('No SUPABASE_DB_URL or DATABASE_URL found, using Supabase REST...')
    console.log('Please run the migration SQL in Supabase SQL Editor.')
    process.exit(1)
  }

  const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } })
  await client.connect()
  console.log('Connected to database')

  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase', 'migrations', '20261022_knteer_payout.sql'), 'utf8')

  try {
    await client.query(sql)
    console.log('Migration executed successfully!')
  } catch (err) {
    console.error('Migration error:', err.message)
    if (err.message.includes('already exists')) {
      console.log('(Some objects already exist - this is OK)')
    }
  }

  // Add tds columns if missing
  try {
    await client.query('ALTER TABLE knteer_payout_transactions ADD COLUMN IF NOT EXISTS tds_amount NUMERIC(12,2) DEFAULT 0')
    await client.query('ALTER TABLE knteer_payout_transactions ADD COLUMN IF NOT EXISTS tds_rate NUMERIC(5,2) DEFAULT 0')
    console.log('TDS columns added/verified')
  } catch (err) {
    console.error('TDS columns error:', err.message)
  }

  // Verify
  var res = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'knteer_payout_transactions' ORDER BY ordinal_position")
  console.log('\nknteer_payout_transactions columns:')
  res.rows.forEach(function(r) { console.log('  -', r.column_name) })

  await client.end()
}

main().catch(function(e) { console.error('Fatal:', e.message); process.exit(1) })
