'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const crypto = require('crypto');
const https = require('https');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const API_KEY = process.env.TEST_API_KEY || 'pk_live_YOUR_API_KEY_HERE';
const API_SECRET = process.env.TEST_API_SECRET || 'sk_live_YOUR_API_SECRET_HERE';

if (API_KEY === 'pk_live_YOUR_API_KEY_HERE' || API_SECRET === 'sk_live_YOUR_API_SECRET_HERE') {
  console.error('❌ Error: Please set TEST_API_KEY and TEST_API_SECRET in .env file');
  process.exit(1);
}

function makeSignedRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now().toString();
    const bodyStr = body ? JSON.stringify(body) : '';
    const signaturePayload = bodyStr + timestamp;
    const signature = crypto
      .createHmac('sha256', API_SECRET)
      .update(signaturePayload)
      .digest('hex');

    const url = new URL('https://api.samedaysolution.in' + path);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'x-signature': signature,
        'x-timestamp': timestamp,
      },
    };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function main() {
  try {
    console.log('=== Verification for TID 96192578 ===\n');

    // Check DB
    const dbResult = await pool.query(
      `SELECT razorpay_txn_id, terminal_id, amount, status, txn_time 
       FROM pos_transactions 
       WHERE terminal_id = $1 
       ORDER BY txn_time DESC 
       LIMIT 5`,
      ['96192578']
    );
    console.log(`[DB] Found ${dbResult.rows.length} transaction(s) for TID 96192578:`);
    dbResult.rows.forEach((t, i) => {
      console.log(`  ${i+1}. ${t.razorpay_txn_id} - ₹${t.amount} - ${t.status} - ${t.txn_time}`);
    });

    // Query API with broader date range
    console.log('\n[API] Querying with date range 2026-02-01 to 2026-02-28...');
    const apiResult = await makeSignedRequest('POST', '/api/partner/pos-transactions', {
      date_from: '2026-02-01',
      date_to: '2026-02-28',
      page: 1,
      page_size: 20,
    });

    console.log(`  Status: ${apiResult.status}`);
    if (apiResult.body.success && apiResult.body.data) {
      const transactions = apiResult.body.data;
      const tid96192578 = transactions.filter(t => t.terminal_id === '96192578');
      
      console.log(`  Total transactions returned: ${transactions.length}`);
      console.log(`  Transactions for TID 96192578: ${tid96192578.length}`);
      
      if (tid96192578.length > 0) {
        console.log('\n  ✅ SUCCESS! Transactions visible in Partner API:');
        tid96192578.forEach((t, i) => {
          console.log(`    ${i+1}. ${t.razorpay_txn_id} - ₹${t.amount} - ${t.status} - ${t.retailer_code}`);
        });
      } else {
        console.log('\n  ⚠️  No transactions for TID 96192578 in API response');
        if (transactions.length > 0) {
          console.log(`  (But found ${transactions.length} other transaction(s))`);
        }
      }
      
      console.log(`\n  Summary: ${JSON.stringify(apiResult.body.summary, null, 2)}`);
    } else {
      console.log(`  Error: ${JSON.stringify(apiResult.body)}`);
    }

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
}

main();

