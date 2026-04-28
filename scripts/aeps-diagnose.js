#!/usr/bin/env node
/**
 * AEPS Environment Diagnostic Tool
 * 
 * Helps diagnose issues with AEPS configuration and setup
 * 
 * Usage:
 *   node scripts/aeps-diagnose.js [options]
 *   
 * Options:
 *   --env              Check environment variables
 *   --mfs110           Check MFS110 device
 *   --supabase         Check Supabase connection
 *   --api              Check API endpoints
 *   --all              Run all checks (default)
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const http = require('http');

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(msg, color = 'reset') {
  console.log(`${COLORS[color]}${msg}${COLORS.reset}`);
}

function section(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'cyan');
  console.log('='.repeat(60) + '\n');
}

function success(msg) {
  log(`✓ ${msg}`, 'green');
}

function error(msg) {
  log(`✗ ${msg}`, 'red');
}

function warn(msg) {
  log(`⚠ ${msg}`, 'yellow');
}

function info(msg) {
  log(`ℹ ${msg}`, 'blue');
}

// Check environment variables
async function checkEnv() {
  section('Environment Variables Check');
  
  const required = [
    'AEPS_USE_MOCK',
    'CHAGHANS_AEPS_CLIENT_ID',
    'CHAGHANS_AEPS_CONSUMER_SECRET',
    'CHAGHANS_AEPS_AUTH_TOKEN',
    'CHAGHANS_AEPS_BASE_URL',
  ];
  
  const optional = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  
  let issues = 0;
  
  // Check .env.local exists
  if (!fs.existsSync('.env.local')) {
    error('.env.local file not found');
    info('Run: cp .env.example .env.local');
    return false;
  }
  success('.env.local exists');
  
  // Load environment
  require('dotenv').config({ path: '.env.local' });
  
  // Check required variables
  console.log('\nRequired Variables:');
  required.forEach(varName => {
    const value = process.env[varName];
    if (!value) {
      error(`${varName} not set`);
      issues++;
    } else if (varName === 'AEPS_USE_MOCK') {
      if (value === 'false') {
        success(`${varName} = false (Real mode enabled)`);
      } else if (value === 'true') {
        warn(`${varName} = true (Mock mode - for real testing, set to false)`);
      } else {
        error(`${varName} = ${value} (Invalid value, must be 'true' or 'false')`);
        issues++;
      }
    } else if (varName === 'CHAGHANS_AEPS_AUTH_TOKEN' && value.startsWith('Bearer ')) {
      error(`${varName} should not include 'Bearer ' prefix (will be added automatically)`);
      issues++;
    } else {
      success(`${varName} is set`);
    }
  });
  
  // Check optional variables
  console.log('\nOptional Variables:');
  optional.forEach(varName => {
    const value = process.env[varName];
    if (!value) {
      warn(`${varName} not set`);
    } else {
      success(`${varName} is set`);
    }
  });
  
  // Check .gitignore
  console.log('\n.gitignore Check:');
  if (fs.existsSync('.gitignore')) {
    const gitignore = fs.readFileSync('.gitignore', 'utf8');
    if (gitignore.includes('.env.local')) {
      success('.env.local is in .gitignore');
    } else {
      error('.env.local is NOT in .gitignore (sensitive data exposed!)');
      issues++;
    }
  }
  
  return issues === 0;
}

// Check MFS110 device
async function checkMFS110() {
  section('MFS110 Device Check');
  
  const rdServiceUrl = process.env.MFS110_RD_SERVICE_URL || 'http://localhost:8000';
  
  console.log(`Checking RD Service at: ${rdServiceUrl}\n`);
  
  try {
    // Try to connect to RD Service
    const response = await axios.get(`${rdServiceUrl}/ping`, { timeout: 5000 });
    success('RD Service is responding');
    
    // Try to get device info
    try {
      const infoResponse = await axios.get(`${rdServiceUrl}/deviceInfo`, { timeout: 5000 });
      const info = infoResponse.data;
      console.log('\nDevice Information:');
      if (info.deviceName) success(`Device: ${info.deviceName}`);
      if (info.deviceVersion) info(`Version: ${info.deviceVersion}`);
      if (info.rdService) success(`RD Service: ${info.rdService}`);
      if (info.status) success(`Status: ${info.status}`);
    } catch (err) {
      warn('Could not get device info');
    }
    
    return true;
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      error(`Cannot connect to RD Service at ${rdServiceUrl}`);
      info('Make sure:');
      console.log('  1. RD Service is installed');
      console.log('  2. RD Service is running');
      console.log('  3. MFS110 device is connected');
      console.log('  4. Port 8000 is not blocked by firewall');
    } else {
      error(`Connection error: ${err.message}`);
    }
    return false;
  }
}

// Check Supabase connection
async function checkSupabase() {
  section('Supabase Connection Check');
  
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!url || !key) {
    error('Supabase credentials not configured');
    info('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');
    return false;
  }
  
  try {
    info(`Testing connection to: ${url}`);
    
    // Test connection to Supabase
    const response = await axios.get(`${url}/rest/v1/?select=1`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
      },
      timeout: 10000,
    });
    
    if (response.status === 200) {
      success('Supabase connection successful');
      return true;
    }
  } catch (err) {
    if (err.code === 'ENOTFOUND') {
      error('Cannot reach Supabase (DNS lookup failed)');
      info('Check your internet connection');
    } else if (err.response?.status === 401) {
      error('Invalid Supabase credentials (401 Unauthorized)');
      info('Check your API key');
    } else {
      error(`Connection error: ${err.message}`);
    }
    return false;
  }
}

// Check API endpoints
async function checkAPI() {
  section('Local API Endpoints Check');
  
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
  
  // Check if dev server is running
  console.log(`Checking API at: ${baseUrl}\n`);
  
  const endpoints = [
    '/api/aeps/banks',
    '/api/aeps/login-status',
  ];
  
  let available = 0;
  
  for (const endpoint of endpoints) {
    try {
      const response = await axios.get(`${baseUrl}${endpoint}`, { 
        timeout: 5000,
        validateStatus: () => true, // Accept any status
      });
      
      if (response.status === 200 || response.status === 400) {
        success(`${endpoint} is available`);
        available++;
      } else if (response.status === 404) {
        error(`${endpoint} not found (404)`);
      } else {
        warn(`${endpoint} returned ${response.status}`);
        available++;
      }
    } catch (err) {
      if (err.code === 'ECONNREFUSED') {
        error(`Dev server not running at ${baseUrl}`);
        info('Run: npm run dev');
        return false;
      } else if (err.code === 'ENOTFOUND') {
        error(`Cannot reach ${baseUrl} (DNS lookup failed)`);
      } else {
        error(`${endpoint} error: ${err.message}`);
      }
    }
  }
  
  return available === endpoints.length;
}

// Test transaction (if credentials available)
async function testTransaction() {
  section('Transaction Endpoint Test');
  
  const useMock = process.env.AEPS_USE_MOCK === 'true';
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
  
  if (useMock) {
    info('Mock mode enabled - this will not process real transactions');
  } else {
    warn('Real mode enabled - test transactions will process with real API');
  }
  
  try {
    const response = await axios.post(`${baseUrl}/api/aeps/transaction/create`, {
      merchantId: 'TEST_MERCHANT',
      transactionType: 'balance_inquiry',
      customerAadhaar: '123456789012',
      customerMobile: '9876543210',
      bankIin: '607094',
    }, {
      timeout: 10000,
      validateStatus: () => true,
    });
    
    if (response.status === 200 || response.status === 400) {
      success('Transaction endpoint is available');
      console.log('\nResponse:');
      console.log(JSON.stringify(response.data, null, 2));
      return true;
    } else if (response.status === 500) {
      error('Server error (500)');
      console.log('\nDetails:');
      console.log(JSON.stringify(response.data, null, 2));
      return false;
    }
  } catch (err) {
    error(`Cannot test transaction: ${err.message}`);
    return false;
  }
}

// Main diagnostic
async function runDiagnostics(options = {}) {
  const runAll = !Object.values(options).some(v => v);
  
  log('\n╔════════════════════════════════════════╗', 'cyan');
  log('║  AEPS Diagnostic Tool v1.0             ║', 'cyan');
  log('╚════════════════════════════════════════╝', 'cyan');
  
  let results = {
    env: null,
    mfs110: null,
    supabase: null,
    api: null,
  };
  
  if (runAll || options.env) {
    results.env = await checkEnv();
  }
  
  if (runAll || options.mfs110) {
    results.mfs110 = await checkMFS110();
  }
  
  if (runAll || options.supabase) {
    results.supabase = await checkSupabase();
  }
  
  if (runAll || options.api) {
    results.api = await checkAPI();
  }
  
  // Summary
  section('Diagnostic Summary');
  
  const checks = Object.entries(results).filter(([_, result]) => result !== null);
  const passed = checks.filter(([_, result]) => result).length;
  const failed = checks.length - passed;
  
  checks.forEach(([name, result]) => {
    const status = result ? '✓ PASS' : '✗ FAIL';
    const color = result ? 'green' : 'red';
    console.log(`${COLORS[color]}${name.toUpperCase().padEnd(15)} ${status}${COLORS.reset}`);
  });
  
  console.log('\n' + '='.repeat(40));
  
  if (failed === 0) {
    success(`All checks passed! (${passed}/${checks.length})`);
    console.log('\nYou are ready to test AEPS transactions!');
    process.exit(0);
  } else {
    error(`${failed} check(s) failed (${passed}/${checks.length} passed)`);
    info('Fix the issues above and run again');
    process.exit(1);
  }
}

// CLI argument parser
const args = process.argv.slice(2);
const options = {
  env: args.includes('--env'),
  mfs110: args.includes('--mfs110'),
  supabase: args.includes('--supabase'),
  api: args.includes('--api'),
};

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
AEPS Diagnostic Tool

Usage:
  node scripts/aeps-diagnose.js [options]

Options:
  --env              Check environment variables
  --mfs110           Check MFS110 device
  --supabase         Check Supabase connection
  --api              Check API endpoints
  --all              Run all checks (default)
  --help             Show this help

Examples:
  node scripts/aeps-diagnose.js
  node scripts/aeps-diagnose.js --env --api
  node scripts/aeps-diagnose.js --mfs110
  `);
  process.exit(0);
}

runDiagnostics(options);
