const { Client } = require('pg');
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=').slice(1).join('=').trim();
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
c.connect().then(async () => {
  const r = await c.query(
    "SELECT partner_trans_id,status,wallet_debited,created_at::date,status_message FROM knteer_payout_transactions WHERE partner_trans_id IN ('9995331665','1640372527')"
  );
  console.log(JSON.stringify(r.rows, null, 2));
  // Also check if refund ledger entries exist
  const r2 = await c.query(
    "SELECT reference_id,transaction_type,amount FROM wallet_ledger WHERE reference_id IN ('REFUND_9995331665_TRANSFER','REFUND_1640372527_TRANSFER')"
  );
  console.log('Refund ledger:', JSON.stringify(r2.rows, null, 2));
  await c.end();
}).catch(e => { console.error(e.message); process.exit(1); });
