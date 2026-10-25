/**
 * 1640372527 — Knteer says "Record Not Found" (code 205) after 5+ hours.
 * Transaction never processed at Knteer. Mark as FAILED, note admin compensation.
 * Do NOT issue system refund — admin already credited ₹16,000 manually.
 */
const { Client } = require('pg');
const fs = require('fs');

const envContent = fs.readFileSync('/home/ubuntu/sameday-backend/.env.local', 'utf8');
const dbUrl = envContent.split('\n').find(l => l.startsWith('DATABASE_URL='))?.split('=').slice(1).join('=').trim();
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

client.connect().then(async () => {
  // Mark FAILED since Knteer has no record after 5+ hours
  const r = await client.query(`
    UPDATE knteer_payout_transactions
    SET 
      status = 'FAILED',
      failure_reason = 'Knteer Record Not Found (code 205) — transaction never processed at provider after 5+ hours',
      status_message = 'Knteer has no record of this transaction (Record Not Found). Never processed. Admin manually compensated ₹16000 on 25-Oct-2026.',
      remarks = 'Knteer status enquiry returned code 205 (Record Not Found) at 21:30 IST. No knteer_trans_id was ever set. Admin push ADMIN_PUSH_1792924018882 (₹16000) compensated retailer on 25-Oct-2026 04:21pm IST.',
      updated_at = NOW()
    WHERE partner_trans_id = '1640372527' AND status = 'PENDING'
    RETURNING id, status, failure_reason, status_message
  `);
  console.log('Updated 1640372527:', JSON.stringify(r.rows, null, 2));

  // Reverse commission (DT and admin got commission on a transaction that never happened)
  // Check if already reversed
  const revCheck = await client.query(`
    SELECT reference_id, credit, debit FROM wallet_ledger
    WHERE reference_id ILIKE 'REV-%1640372527%'
  `);
  console.log('\nExisting reversals for 1640372527:', JSON.stringify(revCheck.rows, null, 2));

  if (revCheck.rows.length === 0) {
    console.log('\n⚠️  No commission reversal found for 1640372527 — commission still sitting with DT and admin!');
    console.log('DT (DT54446846) has ₹9.80 from KNTEER-DTMARGIN-1640372527');
    console.log('Admin has ₹5.00 from KNTEER-REV-1640372527');
    console.log('These need to be reversed manually or via reverseServiceCommission()');
  } else {
    console.log('✅ Commission already reversed');
  }

  await client.end();
}).catch(e => { console.error('Error:', e.message); process.exit(1); });
