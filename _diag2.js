const { createClient } = require('@supabase/supabase-js')
const url = 'https://ohmvvtnfdvvatgofrzta.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9obXZ2dG5mZHZ2YXRnb2ZyenRhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzEwOTE3OCwiZXhwIjoyMDgyNjg1MTc4fQ.4VuswDGmQSe3XIx1_oVH7Z7orkPifl9_uWCP4RWdQhI'
const sb = createClient(url, key, { auth: { persistSession: false } })
;(async () => {
  // Exactly replicate the route call: 5 named args
  const r5 = await sb.rpc('resolve_scheme_for_user', {
    p_user_id: 'RET67853413',
    p_user_role: 'retailer',
    p_service_type: 'bbps',
    p_distributor_id: 'DIS64443281',
    p_md_id: 'MD64352295',
  })
  console.log('RPC 5-arg error:', r5.error ? JSON.stringify(r5.error) : 'none')
  console.log('RPC 5-arg data:', JSON.stringify(r5.data))

  // With 6th arg explicitly
  const r6 = await sb.rpc('resolve_scheme_for_user', {
    p_user_id: 'RET67853413',
    p_user_role: 'retailer',
    p_service_type: 'bbps',
    p_distributor_id: 'DIS64443281',
    p_md_id: 'MD64352295',
    p_partner_entity_id: null,
  })
  console.log('RPC 6-arg error:', r6.error ? JSON.stringify(r6.error) : 'none')
  console.log('RPC 6-arg data:', JSON.stringify(r6.data))

  const schemeId = (r5.data && r5.data[0] && r5.data[0].scheme_id) || (r6.data && r6.data[0] && r6.data[0].scheme_id)
  if (schemeId) {
    const cc = await sb.rpc('calculate_bbps_charge_from_scheme', { p_scheme_id: schemeId, p_amount: 100000, p_category: 'Credit Card' })
    console.log('CHARGE error:', cc.error ? JSON.stringify(cc.error) : 'none')
    console.log('CHARGE data:', JSON.stringify(cc.data))

    const guard = await sb.from('scheme_bbps_commissions').select('category').eq('scheme_id', schemeId).eq('status','active').lte('min_amount',100000).gte('max_amount',100000)
    console.log('GUARD slabs:', JSON.stringify(guard.data), guard.error ? JSON.stringify(guard.error) : '')
  }
})().catch(e => { console.error('FATAL', e.message) })
