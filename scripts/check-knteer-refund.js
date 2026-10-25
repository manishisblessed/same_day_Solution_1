const { Client } = require('pg');
const fs = require('fs');

const envContent = fs.readFileSync('/home/ubuntu/sameday-backend/.env.local', 'utf8');
const dbUrl = envContent.split('\n').find(l => l.startsWith('DATABASE_URL='))?.split('=').slice(1).join('=').trim();

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

client.connect().then(async () => {
  // 1. Check wallet_ledger for refund entries for both transactions
  const refunds = await client.query(`
    SELECT id, retailer_id, credit, debit, reference_id, transaction_type, description, created_at
    FROM wallet_ledger
    WHERE reference_id IN ('REFUND_9995331665', 'REFUND_1640372527')
       OR reference_id ILIKE '%9995331665%'
       OR reference_id ILIKE '%1640372527%'
    ORDER BY created_at DESC
  `);
  console.log('=== Wallet Ledger Refund Entries ===');
  console.log(JSON.stringify(refunds.rows, null, 2));

  // 2. Check add_ledger_entry function signature
  const funcSig = await client.query(`
    SELECT proname, pg_get_function_arguments(oid) as args
    FROM pg_proc
    WHERE proname = 'add_ledger_entry'
    LIMIT 3
  `);
  console.log('\n=== add_ledger_entry signature ===');
  console.log(JSON.stringify(funcSig.rows, null, 2));

  // 3. Check knteer tx statuses
  const txns = await client.query(`
    SELECT id, partner_trans_id, status, status_message, wallet_debited, is_refunded, actual_wallet_debit, transfer_ledger_id
    FROM knteer_payout_transactions
    WHERE partner_trans_id IN ('9995331665', '1640372527')
  `);
  console.log('\n=== Knteer TX rows ===');
  console.log(JSON.stringify(txns.rows, null, 2));

  // 4. Check wallet_ledger around the time of these txns for retailer RET35258193
  const ledger = await client.query(`
    SELECT id, credit, debit, balance_after, reference_id, transaction_type, description, created_at
    FROM wallet_ledger
    WHERE retailer_id = 'RET35258193'
      AND created_at >= '2026-10-25 10:00:00'
    ORDER BY created_at ASC
  `);
  console.log('\n=== Wallet Ledger for RET35258193 (after 10:00 UTC) ===');
  console.log(JSON.stringify(ledger.rows, null, 2));

  await client.end();
}).catch(e => { console.error('Error:', e.message); process.exit(1); });
