const { Client } = require('pg')
const fs = require('fs')

var envContent = fs.readFileSync('.env.local', 'utf8')
var env = {}
envContent.split('\n').forEach(function(line) {
  if (line.startsWith('#') || !line.includes('=')) return
  var idx = line.indexOf('=')
  env[line.substring(0, idx).trim()] = line.substring(idx + 1).trim()
})

var connStr = env.SUPABASE_DB_URL || env.DATABASE_URL
if (!connStr) { console.error('No DB URL'); process.exit(1) }

async function main() {
  var client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } })
  await client.connect()
  console.log('Connected')

  // Change UUID columns to TEXT for partner-id based fields
  var alterSql = [
    'ALTER TABLE knteer_payout_transactions ALTER COLUMN retailer_id TYPE TEXT',
    'ALTER TABLE knteer_payout_transactions ALTER COLUMN distributor_id TYPE TEXT',
    'ALTER TABLE knteer_payout_transactions ALTER COLUMN scheme_id TYPE TEXT',
    'ALTER TABLE knteer_beneficiaries ALTER COLUMN retailer_id TYPE TEXT',
  ]

  for (var i = 0; i < alterSql.length; i++) {
    try {
      await client.query(alterSql[i])
      console.log('OK:', alterSql[i])
    } catch (err) {
      console.log('Skip:', alterSql[i], '-', err.message)
    }
  }

  // Verify
  var res = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'knteer_payout_transactions' AND column_name IN ('retailer_id','distributor_id','scheme_id')")
  console.log('\nVerify:')
  res.rows.forEach(function(r) { console.log('  ', r.column_name, '→', r.data_type) })

  await client.end()
}

main().catch(function(e) { console.error('Fatal:', e.message); process.exit(1) })
