'use strict';

/**
 * Quick script to check recent transactions for a partner
 * Usage: node scripts/checkTransactions.js [terminal_id] [days_back]
 * 
 * Examples:
 *   node scripts/checkTransactions.js                    # All terminals, last 7 days
 *   node scripts/checkTransactions.js 96192578             # Specific TID, last 7 days
 *   node scripts/checkTransactions.js 96192578 1          # Specific TID, last 1 day
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const crypto = require('crypto');
const https = require('https');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Get credentials from environment variables or .env file
const API_KEY = process.env.TEST_API_KEY || 'pk_live_YOUR_API_KEY_HERE';
const API_SECRET = process.env.TEST_API_SECRET || 'sk_live_YOUR_API_SECRET_HERE';
const PARTNER_ID = process.env.TEST_PARTNER_ID || 'fede1413-5fd4-486b-af0a-e2c09184e3c2';

if (API_KEY === 'pk_live_YOUR_API_KEY_HERE' || API_SECRET === 'sk_live_YOUR_API_SECRET_HERE') {
  console.error('❌ Error: Please set TEST_API_KEY and TEST_API_SECRET in .env file');
  console.error('   Example:');
  console.error('   TEST_API_KEY=pk_live_...');
  console.error('   TEST_API_SECRET=sk_live_...');
  process.exit(1);
}

const terminalId = process.argv[2] || null;
const daysBack = parseInt(process.argv[3] || '7', 10);

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
    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - daysBack);
    
    const dateFrom = fromDate.toISOString().split('T')[0];
    const dateTo = today.toISOString().split('T')[0];

    console.log('='.repeat(70));
    console.log('  POS Transaction Checker');
    console.log('='.repeat(70));
    console.log(`\n  Date Range: ${dateFrom} to ${dateTo} (last ${daysBack} day(s))`);
    if (terminalId) {
      console.log(`  Terminal ID: ${terminalId}`);
    } else {
      console.log(`  Terminal ID: ALL`);
    }
    console.log('');

    // Method 1: Check via Partner API (Recommended)
    console.log('[Method 1] Checking via Partner API...');
    const requestBody = {
      date_from: dateFrom,
      date_to: dateTo,
      page: 1,
      page_size: 100,
    };
    
    if (terminalId) {
      requestBody.terminal_id = terminalId;
    }

    const apiResult = await makeSignedRequest('POST', '/api/partner/pos-transactions', requestBody);

    if (apiResult.status === 200 && apiResult.body.success) {
      const transactions = apiResult.body.data || [];
      const pagination = apiResult.body.pagination || {};
      const summary = apiResult.body.summary || {};

      console.log(`  ✅ Status: Success`);
      console.log(`  📊 Total Transactions: ${pagination.total_records || transactions.length}`);
      console.log(`  💰 Total Amount: ₹${summary.total_amount_rupees || '0.00'}`);
      console.log(`  ✅ Captured: ${summary.captured_count || 0}`);
      console.log(`  ❌ Failed: ${summary.failed_count || 0}`);
      console.log(`  🔄 Authorized: ${summary.authorized_count || 0}`);
      console.log(`  🏪 Terminals: ${summary.terminal_count || 0}`);

      if (transactions.length > 0) {
        console.log(`\n  📋 Recent Transactions (showing first ${Math.min(10, transactions.length)}):`);
        console.log('  ' + '-'.repeat(68));
        transactions.slice(0, 10).forEach((t, i) => {
          const time = new Date(t.txn_time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
          console.log(`  ${i + 1}. ${t.razorpay_txn_id.substring(0, 20)}...`);
          console.log(`     TID: ${t.terminal_id} | Amount: ₹${t.amount} | Status: ${t.status}`);
          console.log(`     Mode: ${t.payment_mode || 'N/A'} | Retailer: ${t.retailer_code || 'N/A'}`);
          console.log(`     Time: ${time}`);
          console.log('');
        });
        
        if (transactions.length > 10) {
          console.log(`  ... and ${transactions.length - 10} more transaction(s)`);
        }
      } else {
        console.log(`  ⚠️  No transactions found in this date range`);
      }
    } else {
      console.log(`  ❌ API Error: ${JSON.stringify(apiResult.body)}`);
    }

    // Method 2: Check database directly (for debugging)
    console.log('\n[Method 2] Checking database directly...');
    let dbQuery = `
      SELECT 
        pt.razorpay_txn_id,
        pt.terminal_id,
        pt.amount,
        pt.status,
        pt.payment_mode,
        pt.txn_time,
        pr.retailer_code
      FROM pos_transactions pt
      LEFT JOIN partner_retailers pr ON pr.id = pt.retailer_id
      WHERE pt.partner_id = $1
        AND pt.txn_time >= $2::date
        AND pt.txn_time <= $3::date + interval '1 day'
    `;
    const dbParams = [PARTNER_ID, dateFrom, dateTo];
    
    if (terminalId) {
      dbQuery += ` AND pt.terminal_id = $4`;
      dbParams.push(terminalId);
    }
    
    dbQuery += ` ORDER BY pt.txn_time DESC LIMIT 10`;

    const dbResult = await pool.query(dbQuery, dbParams);
    console.log(`  📊 Found ${dbResult.rows.length} transaction(s) in database`);
    
    if (dbResult.rows.length > 0) {
      console.log(`  Latest transaction: ${dbResult.rows[0].razorpay_txn_id} - ₹${dbResult.rows[0].amount} - ${dbResult.rows[0].status}`);
    }

    console.log('\n' + '='.repeat(70));
    console.log('  ✅ Check Complete');
    console.log('='.repeat(70));
    console.log('\n  💡 Tip: Run this script after each POS transaction to verify it appears.');
    console.log('  💡 Usage: node scripts/checkTransactions.js [terminal_id] [days_back]\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) console.error(error.stack);
  } finally {
    await pool.end();
  }
}

main();

