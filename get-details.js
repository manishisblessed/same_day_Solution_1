require('dotenv').config({ path: '.env.local' });
const {createClient} = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const partnerIds = [
  '71c2d8dc-caa4-45de-9f9a-38bc554c94e8',
  '9ce66cd7-c011-4e7b-b859-40e6b79a222f',
  '71d4a2b8-848a-4668-9686-1a62dc1ada2c'
];

const failedOrderIds = [
  'APITXN050826095428558JFLP',
  'APITXN050826095337015QTVO',
  'APITXN050826093447248OIBK'
];

(async () => {
  // Partner details
  console.log('========== PARTNER DETAILS ==========');
  const {data: partners} = await sb.from('partners')
    .select('id, name, email, phone, business_name, status, created_at')
    .in('id', partnerIds);
  if (partners) {
    partners.forEach(p => {
      console.log(`\nPartner ID: ${p.id}`);
      console.log(`  Name: ${p.name}`);
      console.log(`  Business: ${p.business_name}`);
      console.log(`  Email: ${p.email}`);
      console.log(`  Phone: ${p.phone}`);
      console.log(`  Status: ${p.status}`);
    });
  }

  // 3 Failed transactions full details
  console.log('\n========== 3 FAILED TRANSACTIONS ==========');
  const {data: txns} = await sb.from('shadval_settlement')
    .select('*')
    .in('order_id', failedOrderIds);

  if (txns) {
    for (const t of txns) {
      console.log(`\n--- ${t.order_id} ---`);
      console.log(`  Status: ${t.status}`);
      console.log(`  Status Message: ${t.status_message}`);
      console.log(`  Amount: ₹${t.amount} | Charges: ₹${t.charges} | Total Debit: ₹${t.total_debit}`);
      console.log(`  Beneficiary: ${t.account_holder_name}`);
      console.log(`  Account: ${t.account_number} | IFSC: ${t.ifsc_code}`);
      console.log(`  Mode: ${t.mode}`);
      console.log(`  Reference: ${t.reference_id}`);
      console.log(`  UTR: ${t.utr || 'N/A'}`);
      console.log(`  Retailer ID: ${t.retailer_id}`);
      console.log(`  Created: ${t.created_at}`);

      // Get user/partner info for this txn
      const {data: partner} = await sb.from('partners')
        .select('id, name, email, phone, business_name')
        .eq('id', t.retailer_id).maybeSingle();
      if (partner) {
        console.log(`  Owner: ${partner.name} (${partner.business_name}) | ${partner.phone} | ${partner.email}`);
      } else {
        // Check retailers table
        const {data: retailer} = await sb.from('retailers')
          .select('id, name, email, phone, shop_name')
          .eq('id', t.retailer_id).maybeSingle();
        if (retailer) {
          console.log(`  Owner: ${retailer.name} (${retailer.shop_name}) | ${retailer.phone} | ${retailer.email}`);
        } else {
          // Try users table
          const {data: user} = await sb.from('users')
            .select('id, name, email, phone, role')
            .eq('id', t.retailer_id).maybeSingle();
          if (user) {
            console.log(`  Owner: ${user.name} | ${user.phone} | ${user.email} | role: ${user.role}`);
          } else {
            console.log(`  Owner: NOT FOUND in partners/retailers/users`);
          }
        }
      }
    }
  }
})();
