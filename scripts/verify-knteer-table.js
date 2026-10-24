const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')

var envContent = fs.readFileSync('.env.local', 'utf8')
var env = {}
envContent.split('\n').forEach(function(line) {
  if (line.startsWith('#') || !line.includes('=')) return
  var idx = line.indexOf('=')
  env[line.substring(0, idx).trim()] = line.substring(idx + 1).trim()
})

var sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

sb.from('knteer_payout_transactions').select('id').limit(1).then(function(r) {
  if (r.error) {
    console.log('ERROR:', r.error.message)
  } else {
    console.log('OK - knteer_payout_transactions is accessible via Supabase REST')
  }
})

sb.from('knteer_beneficiaries').select('id').limit(1).then(function(r) {
  if (r.error) {
    console.log('knteer_beneficiaries ERROR:', r.error.message)
  } else {
    console.log('OK - knteer_beneficiaries is accessible')
  }
})
