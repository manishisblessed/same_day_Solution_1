#!/usr/bin/env node
/**
 * Test script to validate Chagans BBPS credentials are loading correctly
 * Run from project root: node scripts/test-chagans-credentials.js
 */

require('dotenv').config({ path: '.env.local' })

function maskSecret(secret, showChars = 4) {
  if (!secret) return '(empty)'
  if (secret.length <= showChars) return secret
  return secret.slice(0, showChars) + '*'.repeat(secret.length - showChars)
}

console.log('\n=== Chagans BBPS Credentials Validation ===\n')

// Test each credential variable
const vars = {
  'BBPS_PROVIDER': process.env.BBPS_PROVIDER,
  'CHAGHANS_BBPS_CLIENT_ID': process.env.CHAGHANS_BBPS_CLIENT_ID,
  'BBPS_CHAGANS_CLIENT_ID': process.env.BBPS_CHAGANS_CLIENT_ID,
  'CHAGHANS_BBPS_CONSUMER_SECRET': process.env.CHAGHANS_BBPS_CONSUMER_SECRET,
  'BBPS_CHAGANS_CLIENT_SECRET': process.env.BBPS_CHAGANS_CLIENT_SECRET,
  'CHAGHANS_BBPS_AUTH_TOKEN': process.env.CHAGHANS_BBPS_AUTH_TOKEN,
  'BBPS_CHAGANS_AUTH_TOKEN': process.env.BBPS_CHAGANS_AUTH_TOKEN,
  'CHAGHANS_BBPS_MERCHANT_ID': process.env.CHAGHANS_BBPS_MERCHANT_ID,
  'BBPS_CHAGANS_MERCHANT_ID': process.env.BBPS_CHAGANS_MERCHANT_ID,
}

Object.entries(vars).forEach(([key, value]) => {
  const display = value ? maskSecret(value, key.includes('MERCHANT') ? 8 : 4) : '(not set)'
  console.log(`  ${key}: ${display}`)
})

console.log('\n=== Resolved Values (Priority Order) ===\n')

// Simulate config.ts resolution logic
const clientId = 
  process.env.CHAGHANS_BBPS_CLIENT_ID ||
  process.env.BBPS_CHAGANS_CLIENT_ID ||
  process.env.CHAGANS_CLIENT_ID ||
  ''

const clientSecret = 
  process.env.CHAGHANS_BBPS_CONSUMER_SECRET ||
  process.env.BBPS_CHAGANS_CLIENT_SECRET ||
  process.env.CHAGANS_CLIENT_SECRET ||
  ''

const authToken = 
  (process.env.CHAGHANS_BBPS_AUTH_TOKEN ||
   process.env.BBPS_CHAGANS_AUTH_TOKEN ||
   process.env.CHAGANS_AUTH_TOKEN ||
   '').replace(/^Bearer\s+/i, '').trim()

const merchantId = 
  process.env.CHAGHANS_BBPS_MERCHANT_ID ||
  process.env.BBPS_CHAGANS_MERCHANT_ID ||
  process.env.CHAGANS_MERCHANT_ID ||
  ''

const baseUrl = process.env.BBPS_CHAGANS_BASE_URL || 'https://chagans.com'
const provider = (process.env.BBPS_PROVIDER || 'sparkup').toLowerCase().trim()

console.log(`Provider: ${provider}`)
if (provider !== 'chagans') {
  console.warn(`⚠ WARNING: Provider is '${provider}', not 'chagans'`)
}

console.log(`Base URL: ${baseUrl}`)
console.log(`Client ID: ${clientId ? maskSecret(clientId, 8) : '(empty)'}`)
console.log(`Client Secret: ${clientSecret ? maskSecret(clientSecret, 4) : '(empty)'}`)
console.log(`Auth Token: ${authToken ? maskSecret(authToken, 10) : '(empty)'}`)
console.log(`Merchant ID: ${merchantId ? maskSecret(merchantId, 8) : '(empty)'}`)

console.log('\n=== Validation ===\n')

const errors = []
const warnings = []

if (!clientId) {
  errors.push('✗ Client ID is empty. Set CHAGHANS_BBPS_CLIENT_ID')
} else {
  console.log(`✓ Client ID is set`)
}

if (!clientSecret) {
  errors.push('✗ Client Secret is empty. Set CHAGHANS_BBPS_CONSUMER_SECRET')
} else {
  console.log(`✓ Client Secret is set`)
}

if (!authToken) {
  errors.push('✗ Auth Token is empty. Set CHAGHANS_BBPS_AUTH_TOKEN')
} else {
  console.log(`✓ Auth Token is set`)
}

if (!merchantId) {
  warnings.push('⚠ Merchant ID not set. You may need CHAGHANS_BBPS_MERCHANT_ID for pay requests.')
} else {
  console.log(`✓ Merchant ID is set`)
}

if (provider !== 'chagans') {
  warnings.push(`⚠ BBPS_PROVIDER is '${provider}', not 'chagans'. Set BBPS_PROVIDER=chagans to enable Chagans.`)
}

console.log()

if (errors.length > 0) {
  errors.forEach(e => console.error(e))
  console.log()
  process.exit(1)
}

if (warnings.length > 0) {
  warnings.forEach(w => console.warn(w))
  console.log()
}

console.log('✓ All required credentials are set and will be loaded correctly.\n')
console.log('Ready to test Chagans BBPS integration!\n')
