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

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

async function main() {
  // Check payout_transactions columns
  var r1 = await sb.from('payout_transactions').select('*').limit(1)
  if (r1.data && r1.data[0]) {
    console.log('payout_transactions columns:', Object.keys(r1.data[0]).join(', '))
  } else if (r1.error) {
    console.log('payout_transactions error:', r1.error.message)
  } else {
    console.log('payout_transactions: exists but empty')
  }

  // Check if knteer_payout_transactions exists
  var r2 = await sb.from('knteer_payout_transactions').select('id').limit(1)
  console.log('knteer_payout_transactions:', r2.error ? 'MISSING - ' + r2.error.message : 'EXISTS')

  // Check shadval equivalent
  var r3 = await sb.from('shadval_settlement_transactions').select('*').limit(1)
  if (r3.data && r3.data[0]) {
    console.log('\nshadval_settlement_transactions columns:')
    console.log(Object.keys(r3.data[0]).join(', '))
  } else if (r3.error) {
    console.log('shadval_settlement_transactions:', r3.error.message)
  }
}

main().catch(function(e) { console.error('Fatal:', e.message) })
