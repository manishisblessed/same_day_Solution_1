require('dotenv').config({ path: '.env.local' });
const {createClient} = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const refs = [
    'REFUND_PSV2_71d4a2b8-848a-4668-9686-1a62dc1ada2c_1785903816603',
    'REFUND_PSV2_71d4a2b8-848a-4668-9686-1a62dc1ada2c_1785903868130',
    'REFUND_SV2_RET14694630_1785902687007'
  ];

  const {data} = await sb.from('partner_wallet_ledger')
    .select('reference_id, transaction_type, credit, debit, opening_balance, closing_balance, description, status, created_at')
    .in('reference_id', refs);

  const {data: wl} = await sb.from('wallet_ledger')
    .select('reference_id, transaction_type, credit, debit, opening_balance, closing_balance, description, status, created_at')
    .in('reference_id', refs);

  const all = [...(data || []), ...(wl || [])];
  all.forEach(r => {
    console.log(`Ref: ${r.reference_id}`);
    console.log(`  Type: ${r.transaction_type}`);
    console.log(`  Credit: ₹${r.credit} | Debit: ₹${r.debit}`);
    console.log(`  Opening: ₹${r.opening_balance} → Closing: ₹${r.closing_balance}`);
    console.log(`  Status: ${r.status}`);
    console.log(`  Description: ${r.description}`);
    console.log(`  Refunded At: ${r.created_at}`);
    console.log('');
  });
})();
