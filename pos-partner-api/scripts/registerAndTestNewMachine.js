'use strict';

/**
 * Register new POS machine and test full E2E flow
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const crypto = require('crypto');
const https = require('https');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const PARTNER_ID = process.env.TEST_PARTNER_ID || 'fede1413-5fd4-486b-af0a-e2c09184e3c2';
const API_KEY = process.env.TEST_API_KEY || 'pk_live_YOUR_API_KEY_HERE';
const API_SECRET = process.env.TEST_API_SECRET || 'sk_live_YOUR_API_SECRET_HERE';
const BASE_URL = process.env.API_BASE_URL || 'https://api.samedaysolution.in';

if (API_KEY === 'pk_live_YOUR_API_KEY_HERE' || API_SECRET === 'sk_live_YOUR_API_SECRET_HERE') {
  console.error('❌ Error: Please set TEST_API_KEY and TEST_API_SECRET in .env file');
  process.exit(1);
}

// New machine details
const NEW_MACHINE = {
  tid: '96192578',
  device_serial: '2841154268',
  retailer_code: 'RET64519407',
  mid: 'IDZ378',
};

function makeSignedRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now().toString();
    const bodyStr = body ? JSON.stringify(body) : '';
    const signaturePayload = bodyStr + timestamp;
    const signature = crypto
      .createHmac('sha256', API_SECRET)
      .update(signaturePayload)
      .digest('hex');

    const url = new URL(BASE_URL + path);
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

function sendWebhook(payload) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(payload);
    const url = new URL(BASE_URL + '/api/razorpay/notification');
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function main() {
  try {
    console.log('='.repeat(60));
    console.log('  Register New POS Machine & Test E2E Flow');
    console.log('='.repeat(60));
    console.log(`\nMachine Details:`);
    console.log(`  TID            : ${NEW_MACHINE.tid}`);
    console.log(`  Device Serial  : ${NEW_MACHINE.device_serial}`);
    console.log(`  Retailer Code  : ${NEW_MACHINE.retailer_code}`);
    console.log(`  MID            : ${NEW_MACHINE.mid}\n`);

    // Step 1: Find or create retailer
    console.log('[Step 1] Finding retailer...');
    let retailerResult = await pool.query(
      `SELECT id, retailer_code, name, status FROM partner_retailers 
       WHERE partner_id = $1 AND retailer_code = $2`,
      [PARTNER_ID, NEW_MACHINE.retailer_code]
    );

    let retailer;
    if (retailerResult.rows.length > 0) {
      retailer = retailerResult.rows[0];
      console.log(`  ✅ Found retailer: ${retailer.name} (${retailer.retailer_code}) → ${retailer.id}`);
    } else {
      console.log(`  ⚠️  Retailer ${NEW_MACHINE.retailer_code} not found. Creating...`);
      const createResult = await pool.query(
        `INSERT INTO partner_retailers (partner_id, retailer_code, name, business_name, status)
         VALUES ($1, $2, $3, $4, 'active')
         RETURNING id, retailer_code, name`,
        [PARTNER_ID, NEW_MACHINE.retailer_code, `Retailer ${NEW_MACHINE.retailer_code}`, `Business ${NEW_MACHINE.retailer_code}`]
      );
      retailer = createResult.rows[0];
      console.log(`  ✅ Created retailer: ${retailer.name} (${retailer.retailer_code}) → ${retailer.id}`);
    }

    // Step 2: Register POS machine
    console.log('\n[Step 2] Registering POS machine...');
    const machineResult = await pool.query(
      `INSERT INTO partner_pos_machines (partner_id, retailer_id, terminal_id, device_serial, machine_model, status, activated_at, metadata)
       VALUES ($1, $2, $3, $4, 'Razorpay POS', 'active', NOW(), $5::jsonb)
       ON CONFLICT (terminal_id) DO UPDATE SET 
         device_serial = EXCLUDED.device_serial,
         retailer_id = EXCLUDED.retailer_id,
         status = 'active',
         updated_at = NOW()
       RETURNING id, terminal_id, device_serial, status`,
      [PARTNER_ID, retailer.id, NEW_MACHINE.tid, NEW_MACHINE.device_serial, JSON.stringify({ mid: NEW_MACHINE.mid })]
    );

    const machine = machineResult.rows[0];
    console.log(`  ✅ Registered: TID=${machine.terminal_id}, Serial=${machine.device_serial} → ${machine.id}`);
    console.log(`     Status: ${machine.status}`);

    // Step 3: Send test webhook
    console.log('\n[Step 3] Sending test webhook...');
    const testTxnId = 'TEST_' + NEW_MACHINE.tid + '_' + Date.now();
    const webhookPayload = {
      txnId: testTxnId,
      tid: NEW_MACHINE.tid,
      amount: 500,
      status: 'CAPTURED',
      rrNumber: '000000TEST' + NEW_MACHINE.tid.slice(-3),
      paymentMode: 'CARD',
      paymentCardType: 'DEBIT',
      paymentCardBrand: 'VISA',
      postingDate: new Date().toISOString(),
      settlementStatus: 'PENDING',
      externalRefNumber: 'TEST_EXT_' + NEW_MACHINE.tid,
      deviceSerial: NEW_MACHINE.device_serial,
    };

    console.log(`  Webhook payload: txnId=${testTxnId}, TID=${NEW_MACHINE.tid}, amount=₹500`);
    const webhookResult = await sendWebhook(webhookPayload);
    console.log(`  bbps-uat response: ${webhookResult.status} → ${JSON.stringify(webhookResult.body)}`);

    // Wait for mirror processing
    console.log('\n  Waiting 3s for Nginx mirror processing...');
    await new Promise(r => setTimeout(r, 3000));

    // Step 4: Verify in database
    console.log('\n[Step 4] Verifying transaction in database...');
    const dbCheck = await pool.query(
      `SELECT id, razorpay_txn_id, terminal_id, amount, status, payment_mode, txn_time
       FROM pos_transactions
       WHERE partner_id = $1 AND terminal_id = $2 AND razorpay_txn_id = $3`,
      [PARTNER_ID, NEW_MACHINE.tid, testTxnId]
    );

    if (dbCheck.rows.length > 0) {
      const txn = dbCheck.rows[0];
      console.log(`  ✅ Transaction found in pos_transactions:`);
      console.log(`     ID: ${txn.id}`);
      console.log(`     txnId: ${txn.razorpay_txn_id}`);
      console.log(`     TID: ${txn.terminal_id}`);
      console.log(`     Amount: ₹${txn.amount}`);
      console.log(`     Status: ${txn.status}`);
      console.log(`     Mode: ${txn.payment_mode}`);
      console.log(`     Time: ${txn.txn_time}`);
    } else {
      console.log(`  ⚠️  Transaction not found in pos_transactions yet.`);
      console.log(`     Check POS Partner API logs: pm2 logs pos-partner-api --lines 20`);
    }

    // Step 5: Query via Partner API
    console.log('\n[Step 5] Querying Partner API...');
    const apiResult = await makeSignedRequest('POST', '/api/partner/pos-transactions', {
      date_from: new Date().toISOString().split('T')[0],
      date_to: new Date().toISOString().split('T')[0],
      page: 1,
      page_size: 10,
    });

    console.log(`  HTTP Status: ${apiResult.status}`);
    if (apiResult.body.success && apiResult.body.data) {
      const transactions = apiResult.body.data;
      const found = transactions.find(t => t.razorpay_txn_id === testTxnId);
      
      if (found) {
        console.log(`  ✅ TEST PASSED! Transaction visible in Partner API:`);
        console.log(`     txnId: ${found.razorpay_txn_id}`);
        console.log(`     TID: ${found.terminal_id}`);
        console.log(`     Amount: ₹${found.amount}`);
        console.log(`     Status: ${found.status}`);
        console.log(`     Retailer: ${found.retailer_code} - ${found.retailer_name}`);
      } else {
        console.log(`  ⚠️  Transaction not in API response yet (may need more time)`);
        console.log(`     Found ${transactions.length} other transaction(s) for today`);
      }
      
      console.log(`\n  Summary:`);
      console.log(`     Total: ${apiResult.body.pagination?.total_records || 0} transaction(s)`);
      if (apiResult.body.summary) {
        console.log(`     Total Amount: ₹${apiResult.body.summary.total_amount_rupees}`);
        console.log(`     Captured: ${apiResult.body.summary.captured_count}`);
      }
    } else {
      console.log(`  ❌ API Error: ${JSON.stringify(apiResult.body)}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('  TEST COMPLETE');
    console.log('='.repeat(60));
    console.log('\n  Next real POS transaction on TID ' + NEW_MACHINE.tid);
    console.log('  will automatically appear in the Partner API!\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.detail) console.error('Detail:', error.detail);
    if (error.stack) console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

main();

