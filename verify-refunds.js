require('dotenv').config({ path: '.env.local' });
const {createClient} = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const ids = [
  'APITXN0508261422128G','APITXN0508261421015N','APITXN0508261418327B',
  'APITXN0508261412422H','APITXN0508261400410O','APITXN0508261359507K',
  'APITXN0508261357338Q','APITXN0508261357329L','APITXN0508261356280L',
  'APITXN0508261347149N','APITXN0508261336440G','APITXN0508261336433F',
  'APITXN0508261334316L','APITXN0508261329484C','APITXN0508261329023J',
  'APITXN0508261255307L','APITXN0508261252504O','APITXN0508261250530J'
];

(async () => {
  const {data: txns} = await sb.from('shadval_settlement').select('order_id, status, status_message').in('order_id', ids);
  console.log('=== SETTLEMENT STATUS (post-fix) ===');
  const counts = {};
  txns.forEach(t => {
    counts[t.status] = (counts[t.status] || 0) + 1;
    console.log(`${t.order_id} | ${t.status} | ${(t.status_message || '').slice(-40)}`);
  });
  console.log('\nStatus counts:', counts);

  console.log('\n=== PARTNER WALLETS (post-fix) ===');
  const {data: pw} = await sb.from('partner_wallets').select('partner_id, balance')
    .in('partner_id', ['71c2d8dc-caa4-45de-9f9a-38bc554c94e8','9ce66cd7-c011-4e7b-b859-40e6b79a222f','71d4a2b8-848a-4668-9686-1a62dc1ada2c']);
  const beforePartner = { '71c2d8dc-caa4-45de-9f9a-38bc554c94e8': 4273.33, '71d4a2b8-848a-4668-9686-1a62dc1ada2c': 4993824.90, '9ce66cd7-c011-4e7b-b859-40e6b79a222f': 83097.77 };
  pw.forEach(p => {
    const diff = (parseFloat(p.balance) - (beforePartner[p.partner_id] || 0)).toFixed(2);
    console.log(`${p.partner_id} | Before: ₹${beforePartner[p.partner_id]} | After: ₹${p.balance} | +₹${diff}`);
  });

  console.log('\n=== RETAILER WALLETS (post-fix) ===');
  const {data: rw} = await sb.from('wallets').select('user_id, balance')
    .in('user_id', ['RET37509596','RET63237124','RET75775108']).eq('wallet_type','primary');
  const beforeRetailer = { 'RET37509596': 960156.81, 'RET63237124': 65725.41, 'RET75775108': 2511.93 };
  rw.forEach(r => {
    const diff = (parseFloat(r.balance) - (beforeRetailer[r.user_id] || 0)).toFixed(2);
    console.log(`${r.user_id} | Before: ₹${beforeRetailer[r.user_id]} | After: ₹${r.balance} | +₹${diff}`);
  });
})();
