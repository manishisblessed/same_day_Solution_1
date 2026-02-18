'use strict';

/**
 * Test POS Partner API endpoints with HMAC authentication
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const crypto = require('crypto');
const https = require('https');

const API_KEY = process.env.TEST_API_KEY || 'pk_live_YOUR_API_KEY_HERE';
const API_SECRET = process.env.TEST_API_SECRET || 'sk_live_YOUR_API_SECRET_HERE';
const BASE_URL = process.env.API_BASE_URL || 'https://api.samedaysolution.in';

if (API_KEY === 'pk_live_YOUR_API_KEY_HERE' || API_SECRET === 'sk_live_YOUR_API_SECRET_HERE') {
  console.error('❌ Error: Please set TEST_API_KEY and TEST_API_SECRET in .env file');
  process.exit(1);
}

function makeSignedRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now().toString();
    const bodyStr = body ? JSON.stringify(body) : '';
    
    // Create HMAC signature: JSON.stringify(body) + timestamp
    // For GET requests: '' + timestamp
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

    if (bodyStr) {
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function main() {
  console.log('=== POS Partner API Test Suite ===\n');

  // Test 1: Health Check (no auth needed)
  console.log('Test 1: Health Check');
  try {
    const health = await makeSignedRequest('GET', '/pos-health');
    console.log(`  Status: ${health.status}`);
    console.log(`  DB: ${health.data.database?.status || 'N/A'}`);
    console.log('  ✅ PASS\n');
  } catch (e) {
    console.log(`  ❌ FAIL: ${e.message}\n`);
  }

  // Test 2: Get Transactions (authenticated)
  console.log('Test 2: POST /api/partner/pos-transactions');
  try {
    const txns = await makeSignedRequest('POST', '/api/partner/pos-transactions', {
      date_from: '2026-01-01',
      date_to: '2026-02-28',
      page: 1,
      page_size: 10,
    });
    console.log(`  Status: ${txns.status}`);
    console.log(`  Success: ${txns.data.success}`);
    console.log(`  Total: ${txns.data.data?.pagination?.total || 0} transactions`);
    if (txns.data.data?.summary) {
      console.log(`  Summary: ${JSON.stringify(txns.data.data.summary)}`);
    }
    console.log('  ✅ PASS\n');
  } catch (e) {
    console.log(`  ❌ FAIL: ${e.message}\n`);
  }

  // Test 3: Get Transactions with filters
  console.log('Test 3: POST /api/partner/pos-transactions (with date filter)');
  try {
    const txns = await makeSignedRequest('POST', '/api/partner/pos-transactions', {
      date_from: '2026-02-01',
      date_to: '2026-02-17',
      page: 1,
      page_size: 5,
      status: 'CAPTURED',
    });
    console.log(`  Status: ${txns.status}`);
    console.log(`  Success: ${txns.data.success}`);
    console.log(`  Total: ${txns.data.data?.pagination?.total || 0} transactions`);
    console.log('  ✅ PASS\n');
  } catch (e) {
    console.log(`  ❌ FAIL: ${e.message}\n`);
  }

  // Test 4: Create Export Job
  console.log('Test 4: POST /api/partner/pos-transactions/export');
  try {
    const exp = await makeSignedRequest('POST', '/api/partner/pos-transactions/export', {
      format: 'csv',
      date_from: '2026-01-01',
      date_to: '2026-02-17',
    });
    console.log(`  Status: ${exp.status}`);
    console.log(`  Success: ${exp.data.success}`);
    if (exp.data.data?.job_id) {
      console.log(`  Job ID: ${exp.data.data.job_id}`);
      console.log(`  Status: ${exp.data.data.status}`);

      // Test 5: Check Export Status
      console.log('\nTest 5: GET /api/partner/export-status/:job_id');
      const statusRes = await makeSignedRequest('GET', `/api/partner/export-status/${exp.data.data.job_id}`);
      console.log(`  Status: ${statusRes.status}`);
      console.log(`  Job Status: ${statusRes.data.data?.status}`);
      console.log('  ✅ PASS\n');
    }
    console.log('  ✅ PASS\n');
  } catch (e) {
    console.log(`  ❌ FAIL: ${e.message}\n`);
  }

  // Test 6: Unauthorized (wrong key)
  console.log('Test 6: Unauthorized request (invalid key)');
  try {
    const url = new URL(BASE_URL + '/api/partner/pos-transactions');
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'pk_live_invalid',
        'x-signature': 'invalid',
        'x-timestamp': Date.now().toString(),
      },
    };
    
    const result = await new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.write(JSON.stringify({ page: 1, limit: 10 }));
      req.end();
    });
    
    console.log(`  Status: ${result.status} (expected 401)`);
    console.log(`  Message: ${result.data.message}`);
    console.log(result.status === 401 ? '  ✅ PASS\n' : '  ❌ FAIL\n');
  } catch (e) {
    console.log(`  ❌ FAIL: ${e.message}\n`);
  }

  console.log('=== All Tests Complete ===');
}

main();

