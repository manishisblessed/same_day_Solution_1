#!/usr/bin/env node
/**
 * AEPS Testing Utility for MFS110 Integration
 * 
 * Usage:
 *   node scripts/aeps-test-util.js [command] [options]
 * 
 * Commands:
 *   check-config      - Verify AEPS configuration
 *   check-banks       - Get available banks
 *   check-login       - Check login status and get Wadh
 *   test-balance      - Test balance inquiry
 *   test-withdrawal   - Test cash withdrawal
 *   test-mini-stmt    - Test mini statement
 *   simulate-txn      - Simulate complete transaction
 */

const axios = require('axios');
const readline = require('readline');

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

// Colors for CLI output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'cyan');
  console.log('='.repeat(60) + '\n');
}

function logSuccess(msg) {
  log(`✓ ${msg}`, 'green');
}

function logError(msg) {
  log(`✗ ${msg}`, 'red');
}

function logWarn(msg) {
  log(`⚠ ${msg}`, 'yellow');
}

async function checkConfig() {
  logSection('AEPS Configuration Check');
  
  try {
    // Check environment variables
    const useMock = process.env.AEPS_USE_MOCK === 'true';
    const baseUrl = process.env.CHAGHANS_AEPS_BASE_URL || 'https://chagans.com/aeps';
    const clientId = process.env.CHAGHANS_AEPS_CLIENT_ID ? '***' : 'NOT SET';
    const secret = process.env.CHAGHANS_AEPS_CONSUMER_SECRET ? '***' : 'NOT SET';
    const token = process.env.CHAGHANS_AEPS_AUTH_TOKEN ? '***' : 'NOT SET';
    
    log('Environment Configuration:', 'blue');
    console.log(`  Mode: ${useMock ? 'MOCK ⚠️  WARNING: Using mock mode!' : 'REAL ✓ Using real API'}`);
    console.log(`  Base URL: ${baseUrl}`);
    console.log(`  Client ID: ${clientId}`);
    console.log(`  Consumer Secret: ${secret}`);
    console.log(`  Auth Token: ${token}`);
    
    if (useMock) {
      logWarn('You are in MOCK mode. Set AEPS_USE_MOCK=false for real transactions.');
    } else {
      logSuccess('Real mode enabled. Real transactions will be processed.');
    }
    
    if (clientId === 'NOT SET' || secret === 'NOT SET' || token === 'NOT SET') {
      logError('Missing credentials. Configure .env.local with Chagans credentials.');
      return false;
    }
    
    logSuccess('Configuration check passed!');
    return true;
  } catch (err) {
    logError(`Configuration check failed: ${err.message}`);
    return false;
  }
}

async function checkBanks(merchantId) {
  logSection('Available Banks');
  
  try {
    const response = await axios.get(`${API_BASE}/api/aeps/banks`, {
      params: { merchantId }
    });
    
    if (response.data.success && response.data.data.length > 0) {
      logSuccess(`Found ${response.data.data.length} banks:`);
      response.data.data.forEach((bank, idx) => {
        console.log(`  ${idx + 1}. ${bank.bankName} (IIN: ${bank.iin})`);
      });
      return response.data.data;
    } else {
      logWarn('No banks found. Check merchant configuration.');
      return [];
    }
  } catch (err) {
    logError(`Failed to get banks: ${err.response?.data?.message || err.message}`);
    return [];
  }
}

async function checkLoginStatus(merchantId, type = 'withdraw') {
  logSection(`Login Status (${type})`);
  
  try {
    const response = await axios.post(`${API_BASE}/api/aeps/login-status`, {
      merchantId,
      type
    });
    
    if (response.data.success) {
      logSuccess('Login status retrieved');
      console.log(`  Wadh: ${response.data.data.wadh?.substring(0, 20)}...`);
      console.log(`  Banks: ${response.data.data.bankList?.length || 0}`);
      
      if (response.data.data.bankList) {
        response.data.data.bankList.forEach((bank, idx) => {
          console.log(`    ${idx + 1}. ${bank.bankName} (${bank.iin})`);
        });
      }
      
      return response.data.data;
    }
  } catch (err) {
    logError(`Failed to get login status: ${err.response?.data?.message || err.message}`);
    return null;
  }
}

async function testBalanceInquiry() {
  logSection('Test: Balance Inquiry');
  
  try {
    const merchantId = await question('Enter Merchant ID: ');
    const aadhaar = await question('Enter Customer Aadhaar (12 digits): ');
    const mobile = await question('Enter Customer Mobile: ');
    const bankIin = await question('Enter Bank IIN (6 digits): ');
    
    log('\n📤 Sending request...', 'blue');
    
    const response = await axios.post(`${API_BASE}/api/aeps/transaction/create`, {
      merchantId,
      transactionType: 'balance_inquiry',
      customerAadhaar: aadhaar,
      customerMobile: mobile,
      bankIin,
      amount: 0,
      biometricData: null // For testing
    });
    
    if (response.data.success) {
      logSuccess('Balance inquiry successful!');
      console.log(`\n📊 Response:`);
      console.log(JSON.stringify(response.data.data, null, 2));
    } else {
      logError(`Transaction failed: ${response.data.message}`);
      console.log(`\nError: ${response.data.error}`);
    }
  } catch (err) {
    logError(`Request failed: ${err.response?.data?.message || err.message}`);
    if (err.response?.data) {
      console.log('\nDetails:');
      console.log(JSON.stringify(err.response.data, null, 2));
    }
  }
}

async function testWithdrawal() {
  logSection('Test: Cash Withdrawal');
  
  try {
    const merchantId = await question('Enter Merchant ID: ');
    const amount = parseInt(await question('Enter Amount (INR): '));
    const aadhaar = await question('Enter Customer Aadhaar (12 digits): ');
    const mobile = await question('Enter Customer Mobile: ');
    const bankIin = await question('Enter Bank IIN (6 digits): ');
    
    log('\n📤 Sending request...', 'blue');
    
    const response = await axios.post(`${API_BASE}/api/aeps/transaction/create`, {
      merchantId,
      transactionType: 'cash_withdrawal',
      amount,
      customerAadhaar: aadhaar,
      customerMobile: mobile,
      bankIin,
      biometricData: null // For testing
    });
    
    if (response.data.success) {
      logSuccess('Withdrawal initiated!');
      console.log(`\n💰 Response:`);
      console.log(JSON.stringify(response.data, null, 2));
    } else {
      logError(`Transaction failed: ${response.data.message}`);
      console.log(`\nError: ${response.data.error}`);
    }
  } catch (err) {
    logError(`Request failed: ${err.response?.data?.message || err.message}`);
    if (err.response?.data) {
      console.log('\nDetails:');
      console.log(JSON.stringify(err.response.data, null, 2));
    }
  }
}

async function interactiveTest() {
  logSection('Interactive AEPS Test');
  
  console.log('Select operation:');
  console.log('  1. Check configuration');
  console.log('  2. Get available banks');
  console.log('  3. Check login status');
  console.log('  4. Test balance inquiry');
  console.log('  5. Test withdrawal');
  console.log('  0. Exit');
  
  const choice = await question('\nEnter choice (0-5): ');
  
  switch (choice) {
    case '1':
      await checkConfig();
      break;
    case '2':
      const mid2 = await question('Enter Merchant ID: ');
      await checkBanks(mid2);
      break;
    case '3':
      const mid3 = await question('Enter Merchant ID: ');
      await checkLoginStatus(mid3);
      break;
    case '4':
      await testBalanceInquiry();
      break;
    case '5':
      await testWithdrawal();
      break;
    case '0':
      log('\nGoodbye! 👋', 'cyan');
      rl.close();
      process.exit(0);
    default:
      logError('Invalid choice');
  }
  
  // Ask if user wants to continue
  const cont = await question('\nContinue? (y/n): ');
  if (cont.toLowerCase() === 'y') {
    await interactiveTest();
  } else {
    log('\nGoodbye! 👋', 'cyan');
    rl.close();
    process.exit(0);
  }
}

// Main CLI handler
async function main() {
  const command = process.argv[2];
  
  logSection('AEPS Testing Utility v1.0');
  
  switch (command) {
    case 'check-config':
      await checkConfig();
      rl.close();
      break;
      
    case 'check-banks':
      const merchantId = process.argv[3];
      if (!merchantId) {
        logError('Usage: aeps-test-util.js check-banks <merchantId>');
        rl.close();
        break;
      }
      await checkBanks(merchantId);
      rl.close();
      break;
      
    case 'check-login':
      const merchantId2 = process.argv[3];
      if (!merchantId2) {
        logError('Usage: aeps-test-util.js check-login <merchantId> [type]');
        rl.close();
        break;
      }
      await checkLoginStatus(merchantId2, process.argv[4] || 'withdraw');
      rl.close();
      break;
      
    case 'test-balance':
      await testBalanceInquiry();
      rl.close();
      break;
      
    case 'test-withdrawal':
      await testWithdrawal();
      rl.close();
      break;
      
    case 'interactive':
    case undefined:
      await interactiveTest();
      break;
      
    default:
      logWarn('Unknown command: ' + command);
      console.log('\nAvailable commands:');
      console.log('  node scripts/aeps-test-util.js');
      console.log('  node scripts/aeps-test-util.js check-config');
      console.log('  node scripts/aeps-test-util.js check-banks <merchantId>');
      console.log('  node scripts/aeps-test-util.js check-login <merchantId> [withdraw|deposit]');
      console.log('  node scripts/aeps-test-util.js test-balance');
      console.log('  node scripts/aeps-test-util.js test-withdrawal');
      rl.close();
  }
}

main();
