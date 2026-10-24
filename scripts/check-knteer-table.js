const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

// Load env
const envPath = path.join(process.cwd(), '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
const env = {}
envContent.split('\n').forEach(line => {
  if (line.startsWith('#') || !line.includes('=')) return
  const idx = line.indexOf('=')
  env[line.substring(0, idx).trim()] = line.substring(idx + 1).trim()
})

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

async function main() {
  // Test select
  const { data, error } = await sb.from('knteer_payout_transactions').select('id').limit(1)
  console.log('SELECT test:')
  console.log('  Error:', error ? error.message + ' | code: ' + error.code + ' | details: ' + error.details : 'none')
  console.log('  Data:', JSON.stringify(data))

  // Test insert (dry run - check columns)
  const { error: insertErr } = await sb.from('knteer_payout_transactions').insert({
    retailer_id: 'TEST_DRY_RUN',
    user_role: 'retailer',
    account_number: '1234567890',
    ifsc_code: 'SBIN0001234',
    account_holder_name: 'Test',
    bank_name: 'SBI',
    email: '',
    mobile: '9999999999',
    amount: 100,
    charges: 5,
    total_debit: 105,
    payment_mode: 'IMPS',
    partner_trans_id: 'TEST_' + Date.now(),
    status: 'PENDING',
    remarks: 'dry run test',
    narration: 'test',
    scheme_id: null,
    scheme_name: null,
    resolved_via: null,
    distributor_id: null,
    distributor_commission: 0,
    md_commission: 0,
  }).select().single()

  console.log('\nINSERT test:')
  console.log('  Error:', insertErr ? insertErr.message + ' | code: ' + insertErr.code + ' | details: ' + insertErr.details + ' | hint: ' + insertErr.hint : 'none (inserted - will clean up)')

  // Clean up if inserted
  if (!insertErr) {
    await sb.from('knteer_payout_transactions').delete().eq('retailer_id', 'TEST_DRY_RUN')
    console.log('  Cleaned up test row')
  }
}

main().catch(e => console.error('Fatal:', e.message))
