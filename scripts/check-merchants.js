const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
s.from('aeps_merchants')
  .select('user_id,merchant_id,kyc_status,provider,onboard_order_id,created_at,updated_at')
  .then(r => { console.log(JSON.stringify(r.data, null, 2)); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
