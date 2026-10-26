const { Client } = require('pg');
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=').slice(1).join('=').trim();
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

c.connect().then(async () => {
  // Simulate what knteer-search route does for ALL status, last 7 days
  const start = '2026-10-19';
  const end = '2026-10-27';

  const r = await c.query(
    `SELECT t.id, t.partner_trans_id, t.retailer_id, t.amount, t.charges,
            t.beneficiary_name, t.account_number, t.ifsc, t.utr,
            t.status, t.failure_reason, t.status_message, t.wallet_debited,
            t.created_at,
            EXISTS(
              SELECT 1 FROM wallet_ledger wl
              WHERE wl.reference_id = 'REFUND_' || t.partner_trans_id || '_TRANSFER'
                AND wl.transaction_type = 'KNTEER_PAYOUT_REFUND'
            ) as is_refunded
     FROM knteer_payout_transactions t
     WHERE t.created_at >= $1 AND t.created_at < $2::date + interval '1 day'
     ORDER BY t.created_at DESC
     LIMIT 20`,
    [start, end]
  );
  console.log(`Found ${r.rows.length} rows`);
  r.rows.forEach(row => {
    console.log(`${row.partner_trans_id} | ${row.status} | wallet_debited=${row.wallet_debited} | is_refunded=${row.is_refunded} | ${row.created_at.toISOString().slice(0,10)}`);
  });
  await c.end();
}).catch(e => { console.error(e.message); process.exit(1); });
