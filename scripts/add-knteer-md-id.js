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

  var queries = [
    // Add md_id column (text, not UUID) for master distributor tracking
    'ALTER TABLE knteer_payout_transactions ADD COLUMN IF NOT EXISTS md_id TEXT',
    // Add compound index for cron queries (retailer, status, created_at)
    'CREATE INDEX IF NOT EXISTS idx_knteer_txn_retailer_status ON knteer_payout_transactions(retailer_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_knteer_txn_pending ON knteer_payout_transactions(status, created_at) WHERE status = \'PENDING\'',
    // beneficiaries: index on account+ifsc for dedup
    'CREATE INDEX IF NOT EXISTS idx_knteer_bene_acct_ifsc ON knteer_beneficiaries(account_number, ifsc_code)',
  ]

  for (var i = 0; i < queries.length; i++) {
    try {
      await client.query(queries[i])
      console.log('OK:', queries[i].substring(0, 70))
    } catch (err) {
      console.log('Skip:', err.message.substring(0, 80))
    }
  }

  // Verify
  var res = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'knteer_payout_transactions' AND column_name IN ('md_id','distributor_id','retailer_id') ORDER BY column_name")
  console.log('\nVerify columns:')
  res.rows.forEach(function(r) { console.log('  ', r.column_name, '→', r.data_type) })

  await client.end()
}

main().catch(function(e) { console.error('Fatal:', e.message); process.exit(1) })
